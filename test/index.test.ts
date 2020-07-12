import { DataStatus, watch, Watcher } from '../src/index'
import assert = require('assert')
import _ = require('lodash')
import { listenerCount } from 'process'
import { stringify } from 'querystring'

interface Person {
    name: string
    age: number
    birthday: Date
    sex: '男' | '女'
}

describe('测试', () => {
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

        assert.deepEqual(sourceData, watcher.data)
        assert.deepEqual(watcher.source, watcher.data)
        
        watcher.data.name = '李四'
        watcher.data.sex = '女'

        /// @ts-ignore
        assert(changes === 3)
        assert(modifies === 1)
        /// @ts-ignore
        assert(watcher.status === DataStatus.Modified) // 'modified'
        const changeds = watcher.getChanges()
        assert.deepEqual(changeds, [
            { property: 'name', oldValue: '张三', newValue: '李四' },
            { property: 'sex', oldValue: '男', newValue: '女' }
        ])
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

        assert.deepEqual(watcher.data, {
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
        for(const item of list) {
            assert.deepEqual(item, datas[i])
            i++
        }

        // 李四 => 哈哈
        list[1].name = '哈哈'

        assert(list.isChanged === true)

        list.add({
            name: '测试项1',
            age: 18,
            birthday: new Date(2011, 10, 31),
            sex: '男'
        }, 0)

        assert(list.addedCount === 1)

        assert.deepEqual(list[0], {
            name: '测试项1',
            age: 18,
            birthday: new Date(2011, 10, 31),
            sex: '男'
        })

        assert(list._length === 5)

        list.delete(list[4])

        /// @ts-ignore
        assert(list._length === 4)

        assert.deepEqual(list.getMetadata(), {
            addeds: [{
                name: '测试项1',
                age: 18,
                birthday: new Date(2011, 10, 31),
                sex: '男'
            }],
            modifieds: [{
                item: {
                    name: '哈哈',
                    birthday: new Date(2011, 10, 31),
                    age: 8,
                    sex: '女'
                },
                changes: [{
                    property: 'name',
                    oldValue: '李四',
                    newValue: '哈哈'
                }]
            }],
            deleteds: [{
                name: '赵六',
                birthday: new Date(2011, 10, 31),
                age: 8,
                sex: '女'
            }],
            originals: [{
                name: '张三',
                birthday: new Date(2011, 10, 31),
                age: 8,
                sex: '男'
            },
            {
                name: '王五',
                birthday: new Date(2011, 10, 31),
                age: 8,
                sex: '男'
            }]
        })

        list.reset()

        assert.deepEqual(list.getMetadata(), {
            addeds: [],
            modifieds: [],
            deleteds: [],
            originals: datas
        })

        /// @ts-ignore
        assert(list.isChanged === false)

        list[1].name = '哈哈'

        list.delete(0)

        assert(deletes === 2)
        assert(list.isChanged === true)
        assert(list._length === datas.length - 1)
        assert.deepEqual(list[0], {
            name: '哈哈',
            birthday: new Date(2011, 10, 31),
            age: 8,
            sex: '女'
        })
    
        list.apply()

        /// @ts-ignore
        assert(list.isChanged === false)

        assert.deepEqual(list.getMetadata(), {
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
            ]
        })
    })
})
