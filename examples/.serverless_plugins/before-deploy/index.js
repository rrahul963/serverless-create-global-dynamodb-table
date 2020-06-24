const helper = require('./helper');

/**
 * The class that will be used as serverless plugin.
 */
class BeforeDeploy {
  constructor(serverless, options) {
    this.hooks = {
      'before:deploy:deploy': () => helper.beforeDeploy(serverless)
    }
  }
}

module.exports = BeforeDeploy
