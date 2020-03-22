const $ = require('../lib/index')
const assert = require('power-assert')

describe('测试', () => {
    it('$()', () => {
        const item = $()
        // assert(item.$isNew() === true)
        assert(JSON.stringify(item) === '{}')
    })

    it('$(data)', () => {
        const item = $({ a: 1, b: 2 })
        // assert(item.$isNew() === false)
        assert.deepEqual(item, { a: 1, b: 2 })
    })

    it('item.property = value', () => {
        const item = $({ a: 1, b: 2 })

        item.b = '100'

        item.c = '1000'

        assert.deepEqual(item, { a: 1, b: '100', c: '1000' })
    })

    it('$:changing, changed', () => {
        const item = $({ a: 'old', b: 'old' })
        let changingTimes = 0
        let changedTimes = 0

        item.$on('changing', function ({ oldValue, newValue, property, cancel }) {
            changingTimes++
            if (property === 'b') return cancel()
            if (property === 'a') {
                assert(oldValue === 'old')
                assert(newValue === 'new')
            }
        })

        item.$on('changed', function ({ oldValue, newValue, property }) {
            changedTimes++
            assert(property === 'a')
            assert(oldValue === 'old')
            assert(newValue === 'new')
        })

        item.a = 'new'
        assert(item.a === 'new')
        item.b = 'new'
        assert(item.b === 'old')

        assert(changingTimes === 2)
        assert(changedTimes === 1)
    })

    it('$:changing, changed, reset, apply', () => {
        const item = $({ a: 'old', b: 'old' })
        let resetTimes = 0
        let applyTimes = 0
        item.$on('reset', function () {
            resetTimes++
        })
        item.$on('apply', function () {
            applyTimes++
        })

        item.a = 'new'
        item.b = 'new'

        assert.deepEqual(item, { a: 'new', b: 'new' })

        item.a = 'old'
        item.b = 'old'

        assert(resetTimes === 1)

        item.a = 'new'
        item.b = 'new'

        item.$apply()

        assert.deepEqual(item, { a: 'new', b: 'new' })

        assert(applyTimes === 1)

        item.b = 'after reset'

        item.$reset()
        assert(item.b === 'new')
        assert(resetTimes === 2)

    })

    it('$(datas)', () => {
        const list = $([
            { a: 'old1', b: 'old1' },
            { a: 'old2', b: 'old2' },
            { a: 'old3', b: 'old3' },
            { a: 'old4', b: 'old4' }
        ])

        list.on('add', (item, index) => {
            console.log(`add ${item} at ${index}`)
        })
        list.on('delete', (item, index) => {
            console.log(`delete ${item} at ${index}`)
        })
        list.on('changed', (item, index) => {
            console.log(`add ${item} at ${index}`)
        })
        list.on('apply', () => {
            console.log('apply')
        })
        list.on('reset', () => {
            console.log('reset')
        })

        list.add({
            a: 'new6',
            b: 'new6'
        })

        list.add({
            a: 'new5',
            b: 'new5'
        }, 4)

        assert.deepEqual(list[4], {
            a: 'new5',
            b: 'new5'
        })

        for (let i = 0; i <= 3; i++) {
            list[i].a = 'new' + (i + 1)
            list[i].b = 'new' + (i + 1)
        }

        list.apply()

        list.delete(list[4])

        assert(list.length === 5)

        list.reset()

        assert(list.length === 6)
        assert.deepEqual(list[0], { a: 'new1', b: 'new1' })
        assert.deepEqual(list[4], { a: 'new5', b: 'new5' })
    })
})
