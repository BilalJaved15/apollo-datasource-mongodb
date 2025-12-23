import { GraphQLError } from 'graphql'
import { InMemoryLRUCache } from '@apollo/utils.keyvaluecache'

import { createCachingMethods } from './cache'

class MongoDataSource {
  constructor(options) {
    const { collection, config } = options
    const setUpCorrectly =
      typeof collection === 'object' && Object.keys(collection).length === 1
    if (!setUpCorrectly) {
      throw new GraphQLError(
        'MongoDataSource constructor must be given an object with a single collection'
      )
    }
    this.collectionName = Object.keys(collection)[0] // eslint-disable-line
    this[this.collectionName] = collection[this.collectionName]

    const cache = config.cache || new InMemoryLRUCache()

    const { debug, allowFlushingCollectionCache } = config

    const methods = createCachingMethods({
      collection: this[this.collectionName],
      cache,
      debug,
      allowFlushingCollectionCache
    })
    Object.assign(this[this.collectionName], methods)
  }
}
// eslint-disable-next-line import/prefer-default-export
export { MongoDataSource }
