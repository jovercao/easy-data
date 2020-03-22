const $ = require('../lib/index')
const assert = require('power-assert')
const _ = require('lodash')

describe('测试', () => {
    it('changeds', () => {
        const item = $({
            a: 'old-a',
            b: 'old-b'
        })
        
        console.log(item.status) // 'original'
        
        item.a = 'new-a'
        item.b = 'new-b'
        item.c = 'add-c'
        
        assert(item.$status() === 'modified') // 'modified'
        const changeds = item.$changeds()
        assert.deepEqual(changeds, [
            { property: 'a', oldValue: 'old-a', newValue: 'new-a' },
            { property: 'b', oldValue: 'old-b', newValue: 'new-b' },
            { property: 'c', newValue: 'add-c' }
        ])
    })
})
