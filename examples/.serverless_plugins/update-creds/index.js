const helper = require('./helper');

/**
 * The class that will be used as serverless plugin.
 */
class UpdateConfig {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options
    this.hooks = {
      'config:credentials:config': () => helper.updateConfig(serverless)
    }
  }
}

module.exports = UpdateConfig
