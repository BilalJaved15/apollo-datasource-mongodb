import DataLoader from 'dataloader'
import sift from 'sift'
import { ObjectId } from 'mongodb'

interface CacheOptions {
  ttl?: number
}

interface HandleCacheParams {
  ttl?: number
  doc: unknown
  key: string
  cache: any
  isRedis?: boolean
}

interface CreateCachingMethodsOptions {
  collection: any
  cache: any
  allowFlushingCollectionCache?: boolean
  debug?: boolean
}

interface CachingMethods {
  loadOneById: (id: any, options?: CacheOptions) => Promise<any>
  loadManyByIds: (ids: any[], options?: CacheOptions) => Promise<any[]>
  loadManyByQuery: (query: any, options?: CacheOptions) => Promise<any[]>
  deleteFromCacheById: (id: any) => Promise<void>
  flushCollectionCache: () => Promise<string | null>
}

function to(
  promise: Promise<any>,
  errorExt?: any,
): Promise<[Error | null, any]> {
  return promise
    .then((data) => [null, data] as [Error | null, any])
    .catch((err) => {
      if (errorExt) {
        Object.assign(err, errorExt)
      }

      return [err, undefined] as [Error | null, any]
    })
}

export const idToString = (id: any): string => {
  if (id && typeof id === 'object' && 'toHexString' in id) {
    return (id as ObjectId).toHexString()
  }
  return String(id)
}

const stringToId = (str: any): ObjectId => {
  if (str && typeof str === 'object' && 'toHexString' in str) {
    return str as ObjectId
  }
  return new ObjectId(str)
}

const handleCache = async ({
  ttl,
  doc,
  key,
  cache,
  isRedis = false,
}: HandleCacheParams): Promise<void> => {
  if (Number.isInteger(ttl)) {
    // https://github.com/apollographql/apollo-server/tree/master/packages/apollo-server-caching#apollo-server-caching
    cache.set(key, isRedis ? JSON.stringify(doc) : doc, {
      ttl,
    })
  }
}

const isValidObjectId = (id: any): boolean => {
  const hex = /[0-9A-Fa-f]{6}/g
  return (
    id !== null &&
    typeof id !== 'undefined' &&
    hex.test(id) &&
    (hex.test(idToString(id)) || hex.test(idToString(stringToId(id))))
  )
}

const remapDocs = (docs: any[], ids: any[]): any[] => {
  const idMap: Record<string, any> = {}
  docs
    .filter((v) => !!v && v._id)
    .forEach((doc) => {
      idMap[idToString(doc._id)] = doc
    })
  return ids.map((id) => idMap[idToString(id)])
}

export const createCachingMethods = ({
  collection,
  cache,
  allowFlushingCollectionCache = false,
  debug = false,
}: CreateCachingMethodsOptions): CachingMethods => {
  const isRedis = typeof cache.store !== 'undefined'
  const isMongoose = typeof collection === 'function'
  const loader = new DataLoader((ids: readonly any[]) =>
    isMongoose
      ? collection
          .find({
            _id: {
              $in: Array.from(ids)
                .filter((v) => !!v)
                .map(stringToId),
            },
          })
          .lean()
          .then((docs: any[]) => remapDocs(docs, Array.from(ids)))
      : collection
          .find({
            _id: {
              $in: Array.from(ids)
                .filter((v) => !!v)
                .map(stringToId),
            },
          })
          .toArray()
          .then((docs: any[]) => remapDocs(docs, Array.from(ids))),
  )

  const cachePrefix = `db:mongo:${
    collection.collectionName || collection.modelName || 'test'
  }:`

  const dataQuery = isMongoose
    ? ({ queries }: { queries: readonly any[] }) =>
        collection
          .find({ $or: Array.from(queries) })
          .lean()
          .then((items: any[]) =>
            Array.from(queries).map((query) => items.filter(sift(query))),
          )
    : ({ queries }: { queries: readonly any[] }) =>
        collection
          .find({ $or: Array.from(queries) })
          .toArray()
          .then((items: any[]) =>
            Array.from(queries).map((query) => items.filter(sift(query))),
          )

  const queryLoader = new DataLoader((queries: readonly any[]) =>
    dataQuery({ queries }),
  )

  const methods: CachingMethods = {
    loadOneById: async (id, { ttl } = {}) => {
      const key = cachePrefix + id

      const [, cacheDoc] = await to(cache.get(key))
      if (debug) {
        console.log('KEY', key, cacheDoc ? 'cache' : 'miss')
      }
      if (cacheDoc) {
        return isRedis ? JSON.parse(cacheDoc) : cacheDoc
      }
      const doc = isValidObjectId(id) ? await loader.load(idToString(id)) : null
      await handleCache({
        ttl,
        doc,
        key,
        cache,
        isRedis,
      })

      return doc
    },

    loadManyByIds: (ids, { ttl } = {}) =>
      Promise.all(
        ids
          .filter((id) => isValidObjectId(id))
          .map((id) => methods.loadOneById(id, { ttl })),
      ),

    loadManyByQuery: async (query, { ttl } = {}) => {
      const key = cachePrefix + JSON.stringify(query)

      const cacheDocs = await cache.get(key)
      if (debug) {
        console.log('KEY', key, cacheDocs ? 'cache' : 'miss')
      }
      if (cacheDocs) {
        return isRedis ? JSON.parse(cacheDocs) : cacheDocs
      }
      const docs = await queryLoader.load(query)
      await handleCache({
        ttl,
        doc: docs,
        key,
        cache,
        isRedis,
      })
      return docs
    },

    deleteFromCacheById: async (id) => {
      const stringId = idToString(id)
      loader.clear(stringId)
      const key = id && typeof id === 'object' ? JSON.stringify(id) : id
      await cache.delete(cachePrefix + key)
    },

    flushCollectionCache: async () => {
      if (!allowFlushingCollectionCache) return null
      if (isRedis) {
        const redis = cache.client
        const stream = redis.scanStream({
          match: `${cachePrefix}*`,
        })
        stream.on('data', (keys: string[]) => {
          if (keys.length) {
            const pipeline = redis.pipeline()
            keys.forEach((key) => {
              pipeline.del(key)
              if (debug) {
                console.log('KEY', key, 'flushed')
              }
            })
            pipeline.exec()
          }
        })
        stream.on('end', () => {
          if (debug) {
            console.log(`Flushed ${cachePrefix}*`)
          }
        })
        return 'ok'
      }
      return null
    },
  }
  return methods
}
