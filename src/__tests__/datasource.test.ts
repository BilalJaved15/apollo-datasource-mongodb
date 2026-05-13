import { MongoDataSource } from '../datasource'

const users = {
  modelName: 'users',
  findById: jest.fn(),
  find: jest.fn()
} as any

describe('MongoDataSource', () => {
  it('sets up caching functions', () => {
    const source = new MongoDataSource({ collection: users, config: {} })
    expect((source as any).users.loadOneById).toBeDefined()
    expect((source as any).users.loadManyByQuery).toBeDefined()
    expect((source as any).users.findById).toBeDefined()
  })
})
