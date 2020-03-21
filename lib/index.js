const _ = require('lodash')
const { EventEmitter } = require('events')

class List extends Array {
    constructor(datas) {
        super()
        this._items = new Set()
        this._addeds = new Set()
        this._removeds = new Set()
        this._changeds = new Set()
        // 原始顺序，用于reset重置
        this._originItemIndexs = new Map()
        this._events = new EventEmitter()
        this._load(datas)
    }

    _attach(data, index) {
        let item = data
        if (!item.$isEasyData) {
            item = createItem(data)
        }
        this._items.add(item)
        if (index >= 0) {
            this._splice(index, 0, item)
        } else {
            index = super.push(item) - 1
        }
        this._originItemIndexs[item] = index
        return item
    }


    _bind(item) {
        item.$on('changed', (e) => {
            if (this._items.has(item) && !this._changeds.has(item)) {
                this._changeds.add(item)
            }
            const itemIndex = super.indexOf(item)
            this._events.emit('change', item, itemIndex)
        })
        item.$on('apply', () => {
            if (this._applying) return
            if (this._changeds.has(item)) {
                this._changeds.delete(item)
            } else if (this._removeds.has(item)) {
                this._removeds.delete(item)
                this._unbind(item)
            } else if (this._addeds.has(item)) {
                this._addeds.delete(item)
            }
        })
        item.$on('reset', () => {
            if (this._resetting) return
            const itemIndex = super.indexOf(item)
            if (this._addeds.has(item)) {
                this._addeds.delete(item)
                this._items.delete(item)
                this._splice(itemIndex, 1)
                this._events.emit('delete', item, itemIndex)
            } else if (this._changeds.has(item)) {
                this._changeds.delete(item)
                this._events.emit('change', item, itemIndex)
            } else if (this._removeds.has(item)) {
                const oldIndex = this._origin.indexOf(item)
                this._removeds.delete(item)
                this._items.add(item)
                // 还原到原有位置
                if (oldIndex < this.length) {
                    this._splice(oldIndex, 0, item)
                } else {
                    super.push(item)
                }
                this._events.emit('add', item, oldIndex)
            }
        })
    }

    _unbind(item) {
        item.$off('changed')
        item.$off('apply')
        item.$off('reset')
    }

    _load(datas) {
        for (const item of [...this._items, ...this._addeds, ...this._removeds]) {
            this._unbind(item)
        }
        this._items.clear()
        this.length = 0
        this._addeds.clear()
        this._removeds.clear()
        this._originItemIndexs.clear()
        this._origin = []
        for (const data of datas) {
            this._origin.push(this._attach(data))
        }
    }

    _splice(start, delectCount, ...items) {
        const offset = items.length - delectCount
        const newLength = this.length + offset
        const oldLength = this.length
        // 元素长度变更，移动元素
        if (offset > 0) {
            for (let i = 0; i < oldLength - start; i++) {
                this[newLength - 1 - i] = this[oldLength - 1 - i]
            }
        }

        if (offset < 0) {
            for (let i = 0; i < oldLength - offset - start; i++) {
                this[start + i] = this[start + offset + i]
            }
            this.length = newLength
        }

        // 将新的元素填充进入
        for (let i = 0; i < items.length; i++) {
            this[i + start] = items[i]
        }
    }

    push(...items) {
        items.forEach(item => this.add(item))
        return this.length
    }

    splice(start, deleteCount, ...items) {
        if (deleteCount) {
            for (let i = start + deleteCount; i >= start; i--) {
                this.delete(this[i])
            }
        }
        items.forEach((item, i) => {
            this.add(item, start + i)
        })
    }

    // set(index, item) {
    //     const old = this[item]
    //     if (old) {
    //         this._unbind(old)
    //         this._items.delete(old)
    //         if (this._changeds.has(old)) {
    //             this._changeds.delete(old)
    //         }
    //         if (this._removeds.has(old)) {
    //             this._changeds.delete(old)
    //         }
    //     }
    //     this._attach(item)
    // }

    clear() {
        for (const item of this._items) {
            this.delete(item)
        }
    }

    apply() {
        this._applying = true
        for (const item of [...this._addeds, ...this._changeds, ...this._removeds]) {
            item.$apply()
        }
        this._addeds.clear()
        this._removeds.clear()
        this._origin = [...this]
        delete this._applying
        this._events.emit('apply')
    }

    reset() {
        this._resetting = true
        for (const item of this._addeds) {
            this._unbind(item)
            this._splice(super.indexOf(item), 1)
            item.$reset()
        }
        for (const item of this._changeds) {
            item.$reset()
        }
        for (const item of this._removeds) {
            item.$reset()
        }
        this._items.clear()
        this._addeds.clear()
        this._removeds.clear()
        // 替换数组内空为三拜九叩数据
        this._splice(0, super.length, ...this._origin)
        this._origin.forEach(item => this._items.add(item))
        delete this._resetting
        this._events.emit('reset')
        
    }

    add(dataOrItem, index) {
        if (this._items.has(dataOrItem)) {
            throw new Error('项已存在！')
        }
        const item = this._attach(dataOrItem, index)
        this._addeds.add(item)
        this._events.emit('add', item, this.length - 1)
    }

    delete(item) {
        if (!this._items.has(item)) {
            throw new Error('不能删除不存在集合内的项！')
        }
        this._items.delete(item)
        const index = super.indexOf(item)
        this._splice(index, 1)
        if (!this._addeds.has(item)) {
            this._removeds.add(item)
        }
        this._events.emit('delete', item, index)
        return this
    }

    isChanged() {
        return this._addeds.size > 0 || this._changeds.size > 0 || this._removeds.size > 0
    }

    changeds() {
        return {
            addeds: [...this._addeds],
            changeds: [...this._changeds],
            removeds: [...this._removeds]
        }
    }

    on(event, handler) {
        this._events.on(event, handler)
    }

    off(event, handler) {
        if (handler) {
            this._events.off(event, handler)
        } else {
            this._events.removeAllListeners(event)
        }
    }
}

function createItem(data) {
    const events = new EventEmitter()
    let origin = data || {}
    let changeds, changedCount = 0

    const __proto__ = {
        $isEasyData: true,
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
        $off(event, handler) {
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
            const cancel = function () {
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
