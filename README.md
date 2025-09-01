# Util-DBImport Lambda

A utility Lambda function for importing DynamoDB tables from S3 exports created by Util-DBExport.

## Features

- Imports complete table schema and data from JSON export files
- Can create new tables with the exact schema from the export
- Supports overwriting existing tables (delete and recreate)
- Recreates all table configurations:
  - Primary key configuration
  - Global Secondary Indexes (GSIs)
  - Local Secondary Indexes (LSIs)
  - Billing mode settings
  - Stream specifications
- Batch imports with error handling
- Progress tracking and detailed logging

## Configuration

Set these environment variables or pass them in the event:

```javascript
{
  "sourceBucket": "my-backups",           // S3 bucket containing export
  "sourceKey": "exports/Users_2024.json", // S3 key of export file (REQUIRED)
  "targetTableName": "Users_Restored",    // Override table name (optional)
  "createTable": true,                    // Create table if doesn't exist
  "overwriteExisting": false              // Delete and recreate if exists
}
```

### Environment Variables

- `SOURCE_BUCKET`: S3 bucket with export files (default: "realmforge-backups")
- `SOURCE_KEY`: S3 key of export file (REQUIRED - no default)
- `TARGET_TABLE_NAME`: Override the table name from export (optional)
- `CREATE_TABLE`: Whether to create table if missing (default: false)
- `OVERWRITE_EXISTING`: Whether to replace existing tables (default: false)
- `AWS_REGION`: AWS region (default: "eu-west-2")
- `BATCH_SIZE`: Items per batch write (default: 25)

## Usage

### Deploy the Lambda

```bash
cd Util-DBImport
npm install
npm run build
aws lambda create-function \
  --function-name DBImport \
  --runtime nodejs20.x \
  --role arn:aws:iam::YOUR_ACCOUNT:role/YOUR_LAMBDA_ROLE \
  --handler handler.handler \
  --zip-file fileb://dist/lambda-package.zip \
  --timeout 900 \
  --memory-size 1024
```

### Invoke the Lambda

```bash
# Import to new table
aws lambda invoke --function-name DBImport \
  --payload '{
    "sourceKey": "dynamodb-exports/Users/Users_2024-01-01.json",
    "createTable": true
  }' \
  output.json

# Restore with different table name
aws lambda invoke --function-name DBImport \
  --payload '{
    "sourceKey": "dynamodb-exports/Users/Users_2024-01-01.json",
    "targetTableName": "Users_Restored",
    "createTable": true
  }' \
  output.json

# Overwrite existing table
aws lambda invoke --function-name DBImport \
  --payload '{
    "sourceKey": "dynamodb-exports/Users/Users_backup.json",
    "overwriteExisting": true,
    "createTable": true
  }' \
  output.json
```

## Import Process

1. **Download Export**: Fetches the JSON export file from S3
2. **Validate Data**: Ensures the export has valid structure
3. **Check Table**: Determines if target table exists
4. **Handle Existing**: Deletes existing table if overwrite enabled
5. **Create Table**: Creates new table with exact schema from export
6. **Import Items**: Batch imports all items with error handling
7. **Report Results**: Returns success/failure counts

## Required IAM Permissions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DeleteTable",
        "dynamodb:DescribeTable",
        "dynamodb:PutItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": "arn:aws:dynamodb:*:*:table/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket/*"
    }
  ]
}
```

## Notes

- Table creation includes all indexes and settings from the original
- Large imports may take several minutes
- Failed items are logged but don't stop the import process
- The Lambda timeout should be set appropriately (15 minutes max)
- For production use, consider adding DLQ for failed items
- Provisioned capacity tables are created with minimal capacity (5 RCU/WCU)

## Error Handling

- **Table Exists**: Set `overwriteExisting: true` to replace
- **Table Missing**: Set `createTable: true` to create
- **Import Failures**: Individual item failures are logged and counted
- **Throttling**: Automatic delays between batches prevent throttling