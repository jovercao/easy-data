import { DataStatus, List, ProxyData, watch, Watcher } from '../src/index'
import assert = require('assert')

interface Person {
    name: string | undefined
    age: number | undefined
    birthday: Date | undefined
    sex: '男' | '女' | undefined
    friends?: Person[]
}


describe('测试', () => {
    it('test', () => {
        const list = watch({"_":"Employee","id":3,"code":"E04","queryCode":"LS","name":"李四","sex":"Male","defaultPositionId":null,"birthday":null,"mobile":"13888888890","email":"abc1@j5.com","description":"初始化数据：undefined","createdAt":"2020-11-24T09:06:18+08:00","updatedAt":"2020-11-24T09:06:18+08:00","operatorId":null,"enabled":true,"userId":3,"belongId":1,"operator":null,"belong":{"id":1,"code":"Sc01","name":"测试有限公司"},"user":{"id":3,"name":"ls"}})
        console.log(list.data)
    })

    it('Watcher', () => {
        let resets: number = 0
        let applys: number = 0
        let modifies: number = 0
        let changes: number = 0
        let deletes: number = 0

        const sourceData: Person = {
            name: '赵六',
            birthday: new Date(2011, 10, 31),
            age: 8,
            sex: '男'
        }

        const watcher = Watcher.new(sourceData)
        assert(watcher.status === DataStatus.New)

        watcher.on('reset', (t: Person, oldSeatus) => {
            resets++
        }).on('apply', () => {
            applys++
        }).on('modify', () => {
            modifies++
        }).on('change', () => {
            changes++
        }).on('delete', () => {
            deletes++
        })

        watcher.data.name = '张三'

        assert(changes === 1)

        watcher.apply()
        /// @ts-ignore
        assert(watcher.status === DataStatus.Original)

        assert(applys === 1)

        assert.deepStrictEqual(sourceData, watcher.data)
        assert.deepStrictEqual(watcher.source, watcher.data)

        watcher.data.name = '李四'
        watcher.data.sex = '女'

        /// @ts-ignore
        assert(changes === 3)
        assert(modifies === 1)
        /// @ts-ignore
        assert(watcher.status === DataStatus.Modified) // 'modified'
        const changeds = watcher.getChanges()
        assert.deepStrictEqual(changeds, {
            name: { oldValue: '张三', newValue: '李四' },
            sex: { oldValue: '男', newValue: '女' }
        })
        // 修改回原有值导致reset触发
        watcher.data.name = '张三'
        watcher.data.sex = '男'

        /// @ts-ignore
        assert(changes === 5)
        assert(modifies === 1)
        assert(resets === 1)

        /// @ts-ignore
        assert(watcher.status === DataStatus.Original)

        watcher.data.name = '李四'
        watcher.data.sex = '女'

        watcher.delete()
        /// @ts-ignore
        assert(changes === 7)
        assert(deletes === 1)
        /// @ts-ignore
        assert(watcher.status === DataStatus.Deleted)

        watcher.reset()
        /// @ts-ignore
        assert(watcher.status === DataStatus.Original)

        assert.deepStrictEqual(watcher.data, {
            name: '张三',
            sex: '男',
            age: 8,
            birthday: new Date(2011, 10, 31)
        })

        watcher.delete()
        /// @ts-ignore
        assert(deletes === 2)
        watcher.apply()

        /// @ts-ignore
        assert(watcher.status === DataStatus.Invalid)
    })

    it('List', () => {
        let changes = 0
        let adds = 0
        let deletes = 0
        let applys = 0
        let resets = 0
        let cleans = 0
        const datas: Person[] = [
            {
                name: '张三',
                birthday: new Date(2011, 10, 31),
                age: 8,
                sex: '男'
            },
            {
                name: '李四',
                birthday: new Date(2011, 10, 31),
                age: 8,
                sex: '女'
            },
            {
                name: '王五',
                birthday: new Date(2011, 10, 31),
                age: 8,
                sex: '男'
            },
            {
                name: '赵六',
                birthday: new Date(2011, 10, 31),
                age: 8,
                sex: '女'
            }
        ]
        const list = watch(datas)
        list.on('change', () => {
            changes++
        }).on('add', () => {
            adds++
        }).on('delete', () => {
            deletes++
        }).on('apply', () => {
            applys++
        }).on('reset', () => {
            resets++
        }).on('clean', () => {
            cleans++
        })

        let i = 0
        for (const item of list) {
            assert.deepStrictEqual(item, datas[i])
            i++
        }

        // 李四 => 哈哈
        list[1].name = '哈哈'

        assert(list.view.length === list.source.length)

        assert(list.isChanged === true)

        list.add({
            name: '测试项1',
            age: 18,
            birthday: new Date(2011, 10, 31),
            sex: '男'
        }, 0)

        assert(list.addedCount === 1)

        assert.deepStrictEqual(list[0], {
            name: '测试项1',
            age: 18,
            birthday: new Date(2011, 10, 31),
            sex: '男'
        })

        assert(list.count === 5)

        list.delete(list[4])
        assert(list.view.length === list.source.length)

        /// @ts-ignore
        assert(list.count === 4)

        assert.deepStrictEqual(list.getMetadata(), {
            addeds: [{
                item: {
                    name: '测试项1',
                    age: 18,
                    birthday: new Date(2011, 10, 31),
                    sex: '男'
                },
                changes: {
                    name: { oldValue: undefined, newValue: '测试项1' },
                    age: { oldValue: undefined, newValue: 18 },
                    birthday: { oldValue: undefined, newValue: new Date(2011, 10, 31) },
                    sex: { oldValue: undefined, newValue: '男' }
                }
            }],
            modifieds: [{
                item: {
                    name: '哈哈',
                    birthday: new Date(2011, 10, 31),
                    age: 8,
                    sex: '女'
                },
                changes: {
                    name: {
                        oldValue: '李四',
                        newValue: '哈哈'
                    }
                }
            }],
            deleteds: [{
                item: {
                    name: '赵六',
                    birthday: new Date(2011, 10, 31),
                    age: 8,
                    sex: '女'
                },
                changes: {}
            }],
            originals: [{
                item: {
                    name: '张三',
                    birthday: new Date(2011, 10, 31),
                    age: 8,
                    sex: '男'
                },
                changes: {}
            },
            {
                item: {
                    name: '王五',
                    birthday: new Date(2011, 10, 31),
                    age: 8,
                    sex: '男'
                },
                changes: {}
            }]
        })

        list.reset()

        assert(list.view.length === list.source.length)

        assert.deepStrictEqual(list.getMetadata(), {
            addeds: [],
            modifieds: [],
            deleteds: [],
            originals: datas.map(item => ({
                item,
                changes: {}
            }))
        })

        /// @ts-ignore
        assert(list.isChanged === false)

        list[1].name = '哈哈'

        list.delete(0)

        assert(deletes === 2)
        assert(list.isChanged === true)
        assert(list.count === datas.length)
        assert.deepStrictEqual(list[0], {
            name: '哈哈',
            birthday: new Date(2011, 10, 31),
            age: 8,
            sex: '女'
        })

        list.apply()

        /// @ts-ignore
        assert(list.isChanged === false)

        assert.deepStrictEqual(list.getMetadata(), {
            addeds: [],
            modifieds: [],
            deleteds: [],
            originals: [
                {
                    name: '哈哈',
                    birthday: new Date(2011, 10, 31),
                    age: 8,
                    sex: '女'
                },
                {
                    name: '王五',
                    birthday: new Date(2011, 10, 31),
                    age: 8,
                    sex: '男'
                },
                {
                    name: '赵六',
                    birthday: new Date(2011, 10, 31),
                    age: 8,
                    sex: '女'
                }
            ].map(item => ({
                item,
                changes: {}
            }))
        })
    })

    it('Watch > Deepth', () => {
        let resets: number = 0
        let applys: number = 0
        let modifies: number = 0
        let changes: number = 0
        let deletes: number = 0

        const sourceData: Person = {
            name: '赵六',
            birthday: new Date(2011, 10, 31),
            age: 8,
            sex: '男',
            friends: [
                {
                    name: '王五',
                    birthday: new Date(2012, 5, 1),
                    age: 7,
                    sex: '男'
                },
                {
                    name: '张三',
                    birthday: new Date(2012, 5, 2),
                    age: 7,
                    sex: '男'
                },
                {
                    name: '李四',
                    birthday: new Date(2012, 5, 3),
                    age: 7,
                    sex: '男'
                }
            ]
        }

        const watcher = Watcher.new(sourceData)
        /// @ts-ignore
        assert(watcher.status === DataStatus.New)

        watcher.on('reset', (t: Person, oldSeatus) => {
            resets++
        }).on('apply', () => {
            applys++
        }).on('modify', () => {
            modifies++
        }).on('change', () => {
            changes++
        }).on('delete', () => {
            deletes++
        })

        watcher.data.name = '张三'

        /// @ts-ignore
        assert(changes === 1)

        assert.deepStrictEqual(sourceData, { ...watcher.data, friends: watcher.data?.friends?.source })

        watcher.apply()
        /// @ts-ignore
        assert(watcher.status === DataStatus.Original)

        /// @ts-ignore
        assert(applys === 1)

        assert.deepStrictEqual(sourceData, { ...watcher.data, friends: watcher.data?.friends?.source })

        watcher.data.name = '李四'
        watcher.data.sex = '女'
        //@ts-ignore
        assert(changes === 3)
        /// @ts-ignore
        assert(modifies === 1)
        /// @ts-ignore
        assert(watcher.status === DataStatus.Modified) // 'modified'
        let changeds = watcher.getChanges()
        /// @ts-ignore
        assert.deepStrictEqual(changeds, {
            name: { oldValue: '张三', newValue: '李四' },
            sex: { oldValue: '男', newValue: '女' },
            friends: {
                addeds: [],
                modifieds: [],
                deleteds: [],
                originals: [
                    {
                        item: {
                            name: '王五',
                            birthday: new Date(2012, 5, 1),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    },
                    {
                        item: {
                            name: '张三',
                            birthday: new Date(2012, 5, 2),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    },
                    {
                        item: {
                            name: '李四',
                            birthday: new Date(2012, 5, 3),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    }
                ]
            }
        }, '初始数据不正确')
        // 修改回原有值导致reset触发
        watcher.data.name = '张三'
        watcher.data.sex = '男'

        /// @ts-ignore
        assert(changes === 5)
        /// @ts-ignore
        assert(modifies === 1)
        /// @ts-ignore
        assert(resets === 1)

        /// @ts-ignore
        assert(watcher.status === DataStatus.Original)

        watcher.data.name = '李四'
        watcher.data.sex = '女'

        watcher.delete()
        /// @ts-ignore
        assert(changes === 7)
        /// @ts-ignore
        assert(deletes === 1)
        /// @ts-ignore
        assert(watcher.status === DataStatus.Deleted)

        changeds = watcher.getChanges()
        /// @ts-ignore
        assert.deepStrictEqual(changeds, {
            friends: {
                addeds: [],
                modifieds: [],
                originals: [],
                deleteds: [
                    {
                        item: {
                            name: '王五',
                            birthday: new Date(2012, 5, 1),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    },
                    {
                        item: {
                            name: '张三',
                            birthday: new Date(2012, 5, 2),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    },
                    {
                        item: {
                            name: '李四',
                            birthday: new Date(2012, 5, 3),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    }
                ]
            }
        }, '已删除未提交的数据不正确')

        watcher.reset()
        /// @ts-ignore
        assert(watcher.status === DataStatus.Original)
        changeds = watcher.getChanges()
        assert.deepStrictEqual(changeds, {
            friends: {
                addeds: [],
                modifieds: [],
                originals: [
                    {
                        item: {
                            name: '王五',
                            birthday: new Date(2012, 5, 1),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    },
                    {
                        item: {
                            name: '张三',
                            birthday: new Date(2012, 5, 2),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    },
                    {
                        item: {
                            name: '李四',
                            birthday: new Date(2012, 5, 3),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    }
                ],
                deleteds: []
            }
        }, '还原后的数据不正确')

        watcher.data.friends.delete(0)
        assert(watcher.status === DataStatus.Modified, '删除明细后的状态不正确')

        changeds = watcher.getChanges()
        assert.deepStrictEqual(changeds, {
            friends: {
                addeds: [],
                modifieds: [],
                originals: [
                    {
                        item: {
                            name: '张三',
                            birthday: new Date(2012, 5, 2),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    },
                    {
                        item: {
                            name: '李四',
                            birthday: new Date(2012, 5, 3),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    }
                ],
                deleteds: [
                    {
                        item: {
                            name: '王五',
                            birthday: new Date(2012, 5, 1),
                            age: 7,
                            sex: '男'
                        },
                        changes: {}
                    }
                ]
            }
        }, '删除明细后的数据不正确')



        watcher.delete()
        //@ts-ignore
        assert(deletes === 2)
        watcher.apply()

        /// @ts-ignore
        assert(watcher.status === DataStatus.Invalid)
        assert.strictEqual(watcher.data.friends.count, 0, '删除后的明细数目不正确')
    })

})
