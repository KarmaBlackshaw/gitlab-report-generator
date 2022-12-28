const Promise = require('bluebird')
const fs = Promise.promisifyAll(require('fs'))

module.exports.pathExists = async path => {
  try {
    await fs.accessAsync(path)
    return true
  } catch (error) {
    return false
  }
}
