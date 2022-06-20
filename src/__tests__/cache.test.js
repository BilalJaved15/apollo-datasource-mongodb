import { InMemoryLRUCache } from 'apollo-server-caching'
import { ObjectId } from 'mongodb'
import sift from 'sift'
import wait from 'waait'

import { createCachingMethods } from '../cache'

const now = new Date()
const oneWeekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)

const docs = {
  id1: {
    _id: 'aaaa0000bbbb0000cccc0000',
    createdAt: now
  },
  id2: {
    _id: ObjectId(),
    createdAt: oneWeekAgo
  },
  id3: {
    _id: ObjectId(),
    createdAt: oneWeekAgo
  },
  id4: {
    _id: null,
    createdAt: new Date()
  },
  id5: {
    _id: '1xxs',
    createdAt: new Date()
  }
}

const collectionName = 'test'
const cacheKey = id => 'db:mongo:' + collectionName + ':' + id

describe('createCachingMethods', () => {
  let collection
  let cache
  let allowFlushingCollectionCache
  let api

  beforeEach(() => {
    collection = {
      collectionName,
      find: jest.fn((args) => ({
        toArray: () =>
          new Promise(resolve => {
            if (args.$or) {
              const { $or: queries } = args
              const siftDocs = Object.keys(docs).reduce((a, k) => [...a, docs[k]], [])
              setTimeout(() => resolve(queries.reduce((arr, query) => [...arr, ...siftDocs.filter(sift(query))], [])), 0)
            } else {
              const { _id: { $in: ids } } = args
              setTimeout(() => resolve(ids.map((id) => {
                return Object.values(docs).find(doc => doc && doc._id && doc._id.toString() === id.toString())
              })
            ), 0)
            }
          })
      }))
    }

    cache = new InMemoryLRUCache()

    allowFlushingCollectionCache = true

    api = createCachingMethods({ collection, cache, allowFlushingCollectionCache })
  })

  it('adds the right methods', () => {
    expect(api.loadOneById).toBeDefined()
    expect(api.loadManyByIds).toBeDefined()
    expect(api.deleteFromCacheById).toBeDefined()
    expect(api.loadManyByQuery).toBeDefined()
  })

  it('finds one', async () => {
    const doc = await api.loadOneById(docs.id1._id)
    expect(doc).toBe(docs.id1)
    expect(collection.find.mock.calls.length).toBe(1)
  })

  it('finds undefined for non existant _id in db, returns undefined', async () => {
    const doc = await api.loadOneById('aaaa0000bbbb0000cccc0001')
    expect(doc).toBe(undefined)
    expect(collection.find.mock.calls.length).toBe(1)
  })

  it('finds nothing for null, returns null', async () => {
    const doc = await api.loadOneById(docs.id4._id) 
    expect(doc).toBe(null)
    expect(collection.find.mock.calls.length).toBe(0)
  })

  it('finds nothing for undefined id', async () => {
    const doc = await api.loadOneById(undefined) 
    expect(doc).toBe(null)
    expect(collection.find.mock.calls.length).toBe(0)
  })

  it('finds two with batching', async () => {
    const foundDocs = await api.loadManyByIds([docs.id2._id, docs.id3._id])
    expect(foundDocs[0]).toBe(docs.id2)
    expect(foundDocs[1]).toBe(docs.id3)
    expect(foundDocs.length).toBe(2)
    expect(collection.find.mock.calls.length).toBe(1)
  })
  it('finds two with batching and skips null and/or undefined', async () => {
    const foundDocs = await api.loadManyByIds([undefined, docs.id2._id, docs.id4._id, docs.id3._id, docs.id4._id])
    expect(foundDocs[0]).toBe(docs.id2)
    expect(foundDocs[1]).toBe(docs.id3)
    expect(foundDocs.length).toBe(2)
    expect(collection.find.mock.calls.length).toBe(1)
  })
  it('finds two with batching and skips null and/or undefined && no valid hex strings', async () => {
    const foundDocs = await api.loadManyByIds([docs.id5._id, undefined, docs.id2._id, docs.id5._id, docs.id4._id, docs.id5._id, docs.id3._id, docs.id4._id, docs.id5._id])
    expect(foundDocs[0]).toBe(docs.id2)
    expect(foundDocs[1]).toBe(docs.id3)
    expect(foundDocs.length).toBe(2)
    expect(collection.find.mock.calls.length).toBe(1)
  })
  it('Should not throw "Argument passed in must be a single String of 12 bytes or a string of 24 hex characters" and return null', async () => {
    const doc = await api.loadOneById(docs.id5._id) 
    expect(doc).toBe(null)
    expect(collection.find.mock.calls.length).toBe(0)
  })

  it('finds two with queries batching', async () => {
    const foundDocs = await api.loadManyByQuery({
      createdAt: { $lte: oneWeekAgo }
    })
    expect(foundDocs[0]).toBe(docs.id2)
    expect(foundDocs[1]).toBe(docs.id3)
    expect(foundDocs.length).toBe(2)

    expect(collection.find.mock.calls.length).toBe(1)
  })

  it(`doesn't cache without ttl`, async () => {
    await api.loadOneById(docs.id1._id)

    let value = await cache.get(cacheKey(docs.id1._id))
    expect(value).toBeUndefined()

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }

    await api.loadManyByQuery(query)

    value = await cache.get(cacheKey(JSON.stringify(query)))
    expect(value).toBeUndefined()
  })

  it(`caches`, async () => {
    await api.loadOneById(docs.id1._id, { ttl: 1 })
    let value = await cache.get(cacheKey(docs.id1._id))
    expect(value).toBe(docs.id1)

    await api.loadOneById(docs.id1._id)
    expect(collection.find.mock.calls.length).toBe(1)

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }
    await api.loadManyByQuery(query, { ttl: 1 })
    value = await cache.get(cacheKey(JSON.stringify(query)))
    expect(value).toEqual([docs.id2, docs.id3])

    await api.loadManyByQuery(query)
    expect(collection.find.mock.calls.length).toBe(2) // it takes count both [ [ { _id: [Object] } ], [ { '$or': [Array] } ] ]
  })

  it(`does not cache null ids`, async () => {
    await api.loadOneById(docs.id4._id, { ttl: 1 })
    let value = await cache.get(cacheKey(docs.id4._id))
    expect(value).toBe(null)

    await api.loadOneById(docs.id4._id)
    expect(collection.find.mock.calls.length).toBe(0)})


  it(`caches with ttl`, async () => {
    await api.loadOneById(docs.id1._id, { ttl: 1 })
    await wait(1001)

    let value = await cache.get(cacheKey(docs.id1._id))
    expect(value).toBeUndefined()

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }
    await api.loadManyByQuery(query, { ttl: 1 })
    await wait(1001)

    value = await cache.get(cacheKey(JSON.stringify(query)))
    expect(value).toBeUndefined()
  })

  it(`deletes from cache`, async () => {
    await api.loadOneById(docs.id1._id, { ttl: 1 })

    let valueBefore = await cache.get(cacheKey(docs.id1._id))
    expect(valueBefore).toBe(docs.id1)

    await api.deleteFromCacheById(docs.id1._id)

    let valueAfter = await cache.get(cacheKey(docs.id1._id))
    expect(valueAfter).toBeUndefined()

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }

    await api.loadManyByQuery(query, { ttl: 1 })

    valueBefore = await cache.get(cacheKey(JSON.stringify(query)))
    expect(valueBefore).toEqual([docs.id2, docs.id3])

    await api.deleteFromCacheById(query)

    valueAfter = await cache.get(cacheKey(JSON.stringify(query)))
    expect(valueAfter).toBeUndefined()
  })
  it('has collection cache flushing disabled by default', async () => {
    api = createCachingMethods({ collection, cache })
    await api.loadOneById(docs.id1._id, { ttl: 1 })
    let value = await cache.get(cacheKey(docs.id1._id))
    expect(value).toBe(docs.id1)

    const query = {
      createdAt: { $lte: oneWeekAgo }
    }
    await api.loadManyByQuery(query, { ttl: 1 })
    value = await cache.get(cacheKey(JSON.stringify(query)))
    expect(value).toEqual([docs.id2, docs.id3])

    const flush = await api.flushCollectionCache()
    expect(flush).toBeNull()

  })
  it('deletes from DataLoader cache', async () => {
    for (const id of [docs.id1._id, docs.id2._id]) {
      await api.loadOneById(id)
      expect(collection.find).toHaveBeenCalled()
      collection.find.mockClear()

      await api.loadOneById(id)
      expect(collection.find).not.toHaveBeenCalled()

      await api.deleteFromCacheById(id)
      await api.loadOneById(id)
      expect(collection.find).toHaveBeenCalled()
    }
  })
})
