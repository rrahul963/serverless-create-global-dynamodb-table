const helper = require('./helper');

/**
 * The class that will be used as serverless plugin.
 */
class CreateGlobalDynamodbTable {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.hooks = {
      'after:deploy:deploy': () => helper.createGlobalDynamodbTable(serverless),
      'remove:remove': () => helper.removeGlobalTable(serverless, options)
    }
  }
}

module.exports = CreateGlobalDynamodbTable
