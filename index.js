const _ = require('lodash')
const { EventEmitter } = require('events')

class List extends Array {
    constructor(datas) {
        super()
        this._items = new Set()
        this._addeds = new Set()
        this._removeds = new Set()
        this._changeds = new Set()
        this.load(datas)
        for(const item of this._items) {
            this.push(item)
        }
        this._events = new EventEmitter()
    }

    $isEasyData() {
        return true
    }

    load(datas) {
        for (const item of [...this._items, ...this._removeds]) {
            item.$un('change')
            item.$un('apply')
            item.$un('reset')
        }
        this._items.clear()
        this.length = 0
        this._addeds.clear()
        this._removeds.clear()
        for (const data of datas) {
            this.attach(data)
        }
    }

    clear() {
        for (const item of this._items) {
            this.delete(item)
        }
    }

    apply() {
        for (const item of [...this._addeds, ...this._changeds, ...this._removeds]) {
            item.$apply()
        }
        this._events.emit('apply')
    }

    _remove(item) {
        const index = this.indexOf(item)
        this.splice(index, 1)
        return index
    }

    reset() {
        for(const item of this._addeds) {
            this._items.delete(item)
            this._remove(item)
        }
        for(const item of this._changeds) {
            item.reset()
        }
        this._events.emit('reset')
    }

    attach(data, index) {
        let item = data
        if (!(item.$isEasyDate())) {
            item = createItem(data)
        }
        this._items.add(item)
        if (index >= 0) {
            this.splice(index, 0, item)
        } else {
            index = this.push(item) - 1
        }
        item.$on('change', () => {
            this._changeds.add(item)
        })
        item.$on('apply', () => {
            if (this._changeds.has(item)) {
                this._changeds.delete(item)
            }

            if (this._removeds.has(item)) {
                this._removeds.delete(item)
            }

            if (this._addeds.has(item)) {
                this._addeds.delete(item)
            }
        })
        item.$on('reset', () => {
            if (this._addeds.has(item)) {
                this._addeds.delete(item)
                this._items.delete(item)
                this._remove(item)
            }

            if (this._changeds.has(item)) {
                this._changeds.delete(item)
            }

            if (this._removeds.has(item)) {
                this._removeds.delete(item)
                this._items.add(item)
                // 还原到原有位置
                if (index < this.length) {
                    this.splice(index, 0, item)
                    this._events.emit('add', item, index)
                } else {
                    this.push(item)
                }
            }
        })
        return data
    }

    add(dataOrItem, index) {
        if (this._items.has(dataOrItem)) {
            throw new Error('项已存在！')
        }
        const item = this.attach(dataOrItem, index)
        this._addeds.add(item)
        this._events.emit('add', item, this.length - 1)
    }

    delete(item) {
        if (!this._items.has(item)) {
            throw new Error('不能删除不存在集合内的项！')
        }
        this._items.delete(item)
        const index = this._remove(item)
        if (!this._addeds.has(item)) {
            this._removeds.add(item)
        }
        this._events.emit('delete', item, index)
        return this
    }

    isChanged() {
        return this._addeds.size !== 0 || this._changeds.size !== 0 || this._removeds.size === 0
    }

    changeds() {
        return {
            addeds: [...this._addeds],
            changeds: [...this._changeds],
            removeds: [...this._removeds]
        }
    }
}

function createItem(data) {
    const events = new EventEmitter()
    let isNew = !data
    let origin = data || {}
    let changeds, changedCount = 0
    
    const __proto__ = {
        $isNew() {
            return isNew
        },
        $isEasyData() {
            return true
        },
        $changed() {
            return changedCount > 0
        },
        $changeds() {
            return changeds
        },
        $apply() {
            changeds = {}
            changedCount = 0
            origin = Object.assign({}, this)
            events.emit('apply')
            isNew = false
        },
        $reset() {
            changeds = {}
            changedCount = 0
            for (const property of Object.keys(current)) {
                delete current[property]
            }
            Object.assign(current, origin)
            events.emit('reset')
        },
        $on(event, handler) {
            return events.on(event, handler)
        },
        $un(event, handler) {
            if (!handler) {
                events.removeAllListeners(event)
            } else {
                events.removeListener(event, handler)
            }
        }
    }

    const current = Object.create(__proto__)

    Object.assign(current, origin)

    return new Proxy(current, {
        set(target, property, value) {
            if (Reflect.has(target, property) && target[property] === value) {
                return
            }
            const oldValue = target[property]

            const e = { property, oldValue, newValue: value }
            let isCanceled = false
            const cancel = function() {
                isCanceled = true
            }
            events.emit('changing', e, cancel)

            if (isCanceled) {
                return
            }

            target[property] = value
            if (!changeds) {
                changeds = {}
            }
            if (Reflect.has(origin, property)) {
                if (origin[property] === value) {
                    delete changeds[property]
                    changedCount--
                    if (changedCount === 0) {
                        events.emit('reset')
                    }
                } else {
                    if (!Reflect.has(changeds, property)) {
                        changedCount++
                    }
                    changeds[property] = value
                }
            } else {
                changeds[property] = value
            }

            events.emit('changed', e)
        }
    })
}

function createList(datas) {
    return new List(datas)
}

function create(datas) {
    if (!datas) {
        return createItem()
    }
    if (_.isArray(datas)) {
        return createList(datas)
    }
    if (_.isPlainObject(datas)) {
        return createItem(datas)
    }
    throw new Error('Datas must typeof Array or PlainObject')
}

module.exports = create
