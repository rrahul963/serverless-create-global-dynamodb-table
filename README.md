# serverless-create-global-dynamodb-table
[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)

A [serverless](http://www.serverless.com) plugin to _automatically_ creates dynamodb global table(s).
The plugin will create the dynamodb table in the specified region(s) and setup sync between  primary and other table(s).

## Install

`npm install --save-dev serverless-create-global-dynamodb-table`

Add the plugin to your `serverless.yml` file:

```yaml
plugins:
  - serverless-create-global-dynamodb-table
```

## Configuration

```yaml
custom:
  globalTables:
  - regions: # list of regions in which you want to set up global tables
      - region-1
      - region-2
    tableKey: 'TABLE_KEY' # Cloudformation output key name if the table is created as part of same serverless service
    tableName: 'TABLE_NAME' # if table is not part of the service then specify the table name. If tableKey param exists then tableName is ignored.
    tags: # List of tags that needs to applied to the new table (optional)
      - Key: tag-key
        Value: tag-value
      - Key: tag-key-2
        Value: tag-value-2
```
