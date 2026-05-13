import { GraphQLError } from 'graphql'
import { InMemoryLRUCache } from '@apollo/utils.keyvaluecache'
import type { Model } from 'mongoose'

import { createCachingMethods } from './cache'
import type { CachingMethods } from './cache'

interface MongoDataSourceConfig {
  cache?: any
  debug?: boolean
  allowFlushingCollectionCache?: boolean
}

interface MongoDataSourceOptions {
  collection: Model<any> | Record<string, Model<any>>
  config: MongoDataSourceConfig
}

const COLLECTION_NAME = Symbol('collectionName')

class MongoDataSource {
  [COLLECTION_NAME]!: string;

  [key: string]: Model<any> & CachingMethods

  // @ts-ignore
  get collectionName(): string {
    return this[COLLECTION_NAME]
  }

  // @ts-ignore
  set collectionName(name: string) {
    this[COLLECTION_NAME] = name
  }

  constructor(options: MongoDataSourceOptions) {
    const { collection, config } = options

    let mongoCollection: any
    let collectionName: string

    // Handle Mongoose Model passed directly
    if (collection && 'modelName' in collection) {
      mongoCollection = collection
      collectionName = (collection as Model<any>).modelName
    }
    // Handle wrapped collection format: { Users: mongoModel }
    else if (
      typeof collection === 'object' &&
      Object.keys(collection).length === 1
    ) {
      const wrappedCollection = collection as Record<string, Model<any>>
      collectionName = Object.keys(wrappedCollection)[0]
      mongoCollection = wrappedCollection[collectionName]
    } else {
      throw new GraphQLError(
        'MongoDataSource constructor must be given either a Mongoose Model or an object with a single collection',
      )
    }

    this[COLLECTION_NAME] = collectionName
    this[collectionName] = mongoCollection as any

    const cache = config.cache || new InMemoryLRUCache()
    const { debug, allowFlushingCollectionCache } = config

    const methods = createCachingMethods({
      collection: mongoCollection,
      cache,
      debug,
      allowFlushingCollectionCache,
    })
    Object.assign(mongoCollection, methods)
  }
}

export { MongoDataSource }
