import { DynamoDBClient, CreateTableCommand, PutItemCommand, DescribeTableCommand, DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { marshall } from '@aws-sdk/util-dynamodb';

// Configuration - Set these values for your import
const CONFIG = {
  SOURCE_BUCKET: process.env.SOURCE_BUCKET || 'realmforge-backups',  // S3 bucket containing export file
  SOURCE_KEY: process.env.SOURCE_KEY || '',  // S3 key of the export file (must be provided)
  TARGET_TABLE_NAME: process.env.TARGET_TABLE_NAME || '',  // Override table name (optional)
  CREATE_TABLE: process.env.CREATE_TABLE === 'true',  // Whether to create table if it doesn't exist
  OVERWRITE_EXISTING: process.env.OVERWRITE_EXISTING === 'true',  // Whether to overwrite existing table
  AWS_REGION: process.env.AWS_REGION || 'eu-west-2',
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '25')  // DynamoDB batch write limit
};

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: CONFIG.AWS_REGION });
const s3Client = new S3Client({ region: CONFIG.AWS_REGION });

/**
 * Main Lambda handler for DynamoDB table import
 * Imports table schema and data from S3 JSON export
 */
export const handler = async (event) => {
  console.log('Starting DynamoDB import process');
  console.log('Configuration:', CONFIG);
  
  try {
    // Override config with event parameters if provided
    const sourceBucket = event.sourceBucket || CONFIG.SOURCE_BUCKET;
    const sourceKey = event.sourceKey || CONFIG.SOURCE_KEY;
    const targetTableName = event.targetTableName || CONFIG.TARGET_TABLE_NAME;
    const createTable = event.createTable !== undefined ? event.createTable : CONFIG.CREATE_TABLE;
    const overwriteExisting = event.overwriteExisting !== undefined ? event.overwriteExisting : CONFIG.OVERWRITE_EXISTING;
    
    if (!sourceKey) {
      throw new Error('SOURCE_KEY must be provided either as environment variable or event parameter');
    }
    
    console.log(`Importing from s3://${sourceBucket}/${sourceKey}`);
    
    // Step 1: Download and parse export file from S3
    const exportData = await downloadFromS3(sourceBucket, sourceKey);
    
    // Validate export data structure
    if (!exportData.exportMetadata || !exportData.tableSchema || !exportData.items) {
      throw new Error('Invalid export file format. Missing required fields.');
    }
    
    const tableName = targetTableName || exportData.tableSchema.tableName;
    console.log(`Target table name: ${tableName}`);
    console.log(`Items to import: ${exportData.items.length}`);
    
    // Step 2: Check if table exists
    const tableExists = await checkTableExists(tableName);
    
    if (tableExists && !overwriteExisting) {
      throw new Error(`Table ${tableName} already exists. Set OVERWRITE_EXISTING=true to replace it.`);
    }
    
    // Step 3: Delete existing table if overwrite is enabled
    if (tableExists && overwriteExisting) {
      console.log(`Deleting existing table: ${tableName}`);
      await deleteTable(tableName);
      await waitForTableDeletion(tableName);
    }
    
    // Step 4: Create table if needed
    if (!tableExists || overwriteExisting) {
      if (createTable) {
        console.log(`Creating table: ${tableName}`);
        await createTableFromSchema(tableName, exportData.tableSchema);
        await waitForTableCreation(tableName);
      } else {
        throw new Error(`Table ${tableName} does not exist and CREATE_TABLE is not enabled`);
      }
    }
    
    // Step 5: Import items in batches
    const importResults = await importItems(tableName, exportData.items);
    
    // Return success response
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Import completed successfully',
        tableName: tableName,
        importedItems: importResults.successCount,
        failedItems: importResults.failedCount,
        sourceFile: `s3://${sourceBucket}/${sourceKey}`,
        importDate: new Date().toISOString()
      })
    };
    
  } catch (error) {
    console.error('Import failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Import failed',
        error: error.message
      })
    };
  }
};

/**
 * Download and parse JSON export file from S3
 */
async function downloadFromS3(bucket, key) {
  try {
    console.log(`Downloading from S3: ${bucket}/${key}`);
    
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key
    });
    
    const response = await s3Client.send(command);
    const jsonString = await response.Body.transformToString();
    const data = JSON.parse(jsonString);
    
    console.log(`Downloaded and parsed export file. Size: ${(jsonString.length / 1024 / 1024).toFixed(2)} MB`);
    return data;
    
  } catch (error) {
    console.error('Error downloading from S3:', error);
    throw new Error(`Failed to download from S3: ${error.message}`);
  }
}

/**
 * Check if a DynamoDB table exists
 */
async function checkTableExists(tableName) {
  try {
    const command = new DescribeTableCommand({ TableName: tableName });
    await dynamoClient.send(command);
    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return false;
    }
    throw error;
  }
}

/**
 * Delete a DynamoDB table
 */
async function deleteTable(tableName) {
  try {
    const command = new DeleteTableCommand({ TableName: tableName });
    await dynamoClient.send(command);
    console.log(`Table deletion initiated: ${tableName}`);
  } catch (error) {
    console.error('Error deleting table:', error);
    throw new Error(`Failed to delete table ${tableName}: ${error.message}`);
  }
}

/**
 * Wait for table to be fully deleted
 */
async function waitForTableDeletion(tableName, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const exists = await checkTableExists(tableName);
    if (!exists) {
      console.log(`Table ${tableName} has been deleted`);
      return;
    }
    console.log(`Waiting for table deletion... (${i + 1}/${maxAttempts})`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Timeout waiting for table ${tableName} to be deleted`);
}

/**
 * Create a DynamoDB table from exported schema
 */
async function createTableFromSchema(tableName, schema) {
  try {
    const params = {
      TableName: tableName,
      KeySchema: schema.keySchema,
      AttributeDefinitions: schema.attributeDefinitions,
      BillingMode: schema.billingMode || 'PAY_PER_REQUEST'
    };
    
    // Add GSIs if present
    if (schema.globalSecondaryIndexes && schema.globalSecondaryIndexes.length > 0) {
      params.GlobalSecondaryIndexes = schema.globalSecondaryIndexes.map(gsi => ({
        IndexName: gsi.IndexName,
        KeySchema: gsi.KeySchema,
        Projection: gsi.Projection,
        ProvisionedThroughput: params.BillingMode === 'PROVISIONED' ? gsi.ProvisionedThroughput : undefined
      }));
    }
    
    // Add LSIs if present
    if (schema.localSecondaryIndexes && schema.localSecondaryIndexes.length > 0) {
      params.LocalSecondaryIndexes = schema.localSecondaryIndexes.map(lsi => ({
        IndexName: lsi.IndexName,
        KeySchema: lsi.KeySchema,
        Projection: lsi.Projection
      }));
    }
    
    // Add stream specification if present
    if (schema.streamSpecification) {
      params.StreamSpecification = schema.streamSpecification;
    }
    
    // Add provisioned throughput if not using on-demand billing
    if (params.BillingMode === 'PROVISIONED') {
      params.ProvisionedThroughput = {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      };
    }
    
    const command = new CreateTableCommand(params);
    await dynamoClient.send(command);
    console.log(`Table creation initiated: ${tableName}`);
    
  } catch (error) {
    console.error('Error creating table:', error);
    throw new Error(`Failed to create table ${tableName}: ${error.message}`);
  }
}

/**
 * Wait for table to be fully created and active
 */
async function waitForTableCreation(tableName, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const command = new DescribeTableCommand({ TableName: tableName });
      const response = await dynamoClient.send(command);
      
      if (response.Table.TableStatus === 'ACTIVE') {
        console.log(`Table ${tableName} is now active`);
        return;
      }
      
      console.log(`Waiting for table creation... Status: ${response.Table.TableStatus} (${i + 1}/${maxAttempts})`);
    } catch (error) {
      console.log(`Table not yet available... (${i + 1}/${maxAttempts})`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Timeout waiting for table ${tableName} to become active`);
}

/**
 * Import items into DynamoDB table in batches
 */
async function importItems(tableName, items) {
  const results = {
    successCount: 0,
    failedCount: 0,
    failedItems: []
  };
  
  const batchSize = CONFIG.BATCH_SIZE;
  const totalBatches = Math.ceil(items.length / batchSize);
  
  console.log(`Starting import of ${items.length} items in ${totalBatches} batches`);
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    
    console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} items)`);
    
    // Process items individually to handle errors gracefully
    for (const item of batch) {
      try {
        const command = new PutItemCommand({
          TableName: tableName,
          Item: marshall(item)
        });
        
        await dynamoClient.send(command);
        results.successCount++;
        
      } catch (error) {
        console.error(`Failed to import item:`, error);
        results.failedCount++;
        results.failedItems.push({
          item: item,
          error: error.message
        });
      }
    }
    
    // Add a small delay between batches to avoid throttling
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Log progress every 10 batches
    if (batchNumber % 10 === 0 || batchNumber === totalBatches) {
      console.log(`Progress: ${results.successCount}/${items.length} items imported successfully`);
    }
  }
  
  console.log(`Import complete. Success: ${results.successCount}, Failed: ${results.failedCount}`);
  
  if (results.failedCount > 0) {
    console.error(`Failed to import ${results.failedCount} items. First few errors:`, 
      results.failedItems.slice(0, 5));
  }
  
  return results;
}