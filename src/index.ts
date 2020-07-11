const _ = require('lodash')
const { EventEmitter } = require('events')

class List extends Array {
    constructor(datas) {
        super()
        this._items = new Set()
        this._addeds = new Set()
        this._removeds = new Set()
        this._modifieds = new Set()
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
        if (item.$isPhantom()) {
            throw new Error('Add item opration is allowed original item or plain object item only.')
        }
        this._items.add(item)
        if (index >= 0) {
            this._splice(index, 0, item)
        } else {
            index = super.push(item) - 1
        }
        this._originItemIndexs[item] = index
        this._bind(item)
        return item
    }

    _bind(item) {
        item.$on('change', (e) => {
            if (this._items.has(item) && !this._modifieds.has(item)) {
                this._modifieds.add(item)
            }
            const itemIndex = super.indexOf(item)
            this._events.emit('change', item, itemIndex)
        })
        item.$on('apply', () => {
            if (this._applying) return
            if (this._modifieds.has(item)) {
                this._modifieds.delete(item)
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
            } else if (this._modifieds.has(item)) {
                this._modifieds.delete(item)
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

        item.$on('delete', () => {
            if (this._items.has(item)) {
                this.delete(item)
            }
        })
    }

    _unbind(item) {
        item.$off('changed')
        item.$off('apply')
        item.$off('reset')
        item.$off('delete')
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
        const oldLength = this.length
        const offset = items.length - delectCount
        const newLength = oldLength + offset
        // 元素长度变更，移动元素
        if (offset > 0) {
            for (let i = 0; i < oldLength - start - delectCount; i++) {
                this[newLength - 1 - i] = this[oldLength - 1 - i]
            }
        }

        if (offset < 0) {
            for (let i = 0; i < oldLength - newLength - start; i++) {
                this[start + i] = this[start - offset + i]
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
        throw new Error('不允许调用splice方法')
        // if (deleteCount > 0) {
        //     for (let i = start + deleteCount; i >= start; i--) {
        //         this.delete(this[i])
        //     }
        // }
        
        // items.forEach((item, i) => {
        //     this.add(item, start + i)
        // })
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
        for (const item of [...this._addeds, ...this._modifieds, ...this._removeds]) {
            item.$apply()
        }
        this._addeds.clear()
        this._removeds.clear()
        this._origin = [...this]
        this._applying = false
        this._events.emit('apply')
    }

    reset() {
        this._resetting = true
        for (const item of this._addeds) {
            this._unbind(item)
            this._splice(super.indexOf(item), 1)
            item.$reset()
        }
        for (const item of this._modifieds) {
            item.$reset()
        }
        for (const item of this._removeds) {
            item.$reset()
        }
        this._items.clear()
        this._addeds.clear()
        this._removeds.clear()
        // 替换数组内空为三拜九叩数据
        this._splice(0, this.length, ...this._origin)
        this._origin.forEach(item => this._items.add(item))
        this._resetting = false
        this._events.emit('reset')
    }

    add(dataOrItem, index) {
        if (this._items.has(dataOrItem)) {
            throw new Error('The item is exists.')
        }
        const item = this._attach(dataOrItem, index)
        this._addeds.add(item)
        this._events.emit('add', item, this.length - 1)
        return item
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
        if (item.$status() !== 'deleted') {
            item.$delete()
        }
        this._events.emit('delete', item, index)
        return this
    }

    isChanged() {
        return this._addeds.size > 0 || this._modifieds.size > 0 || this._removeds.size > 0
    }

    getChangeds() {
        return {
            addeds: [...this._addeds],
            modifieds: [...this._modifieds],
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
    let modifieds = new Set()
    const childs = {}
    let status = !data ? 'new' : 'original'

    const checkInvalid = () => {
        if (status === 'invalid') {
            throw new Error('不允许操作无效的对象！')
        }
    }
    const prototype = {
        $isEasyData: true,
        $status() {
            return status
        },
        $isPhantom() {
            return status !== 'original'
        },
        $isInvalid() {
            return status === 'invalid'
        },
        $changeds() {
            checkInvalid()
            if (status === 'modified') {
                return Array.from(modifieds).map(property => {
                    const changedItem = {
                        property,
                        newValue: instance[property]
                    }
                    if (origin.hasOwnProperty(property)) {
                        changedItem.oldValue = origin[property]
                    }
                    return changedItem
                })
            }
            return []
        },
        $apply() {
            checkInvalid()
            switch (status) {
                case 'deleted':
                    status = 'invalid'
                    break
                case 'modified':
                    modifieds.clear()
                    origin = Object.assign({}, this)
                    status = 'original'
                    break
                case 'new':
                    status = 'original'
                    origin = Object.assign({}, this)
                    break
            }
            events.emit('apply')
        },
        $reset() {
            checkInvalid()
            switch (status) {
                case 'modified':
                    Array.from(modifieds).forEach(property => {
                        if (origin.hasOwnProperty(property)) {
                            instance[property] = origin[property]
                        } else {
                            delete instance[property]
                        }
                    })
                    modifieds.clear()
                    status = 'original'
                    break
                case 'new':
                    status = 'invalid'
                    break
                case 'deleted':
                    status = 'original'
                    break
            }
            events.emit('reset')
        },
        $delete() {
            checkInvalid()
            switch (status) {
                case 'new':
                    instance.$reset()
                    break
                case 'modified':
                    this.$reset()
                    this.$delete()
                    break
                case 'original':
                    status = 'deleted'
                    break
            }
            events.emit('deleted')
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
        },
        /**
         * 定义子属性，可以是单个对象，亦可是列表
         * @param {*} datas plain object data
         */
        $defineChild(name, datas) {
            if (!Reflect.has(this, name)) {
                throw new Error(`子属性不能定义为已经存在的属性！${name}`)
            }
            const child = create(datas)
            Object.defineProperty(this, name, { value: child })
            childs[name] = child
        },
        $childs() {
            return Object.entries(childs)
        },
        $set(property, value) {
            checkInvalid()
            if (status === 'deleted') {
                throw new Error('不允许修改已删除的实例！')
            }
            if (instance.hasOwnProperty(property) && instance[property] === value) {
                return
            }
            const oldValue = instance[property]
            const newValue = value

            let isCanceled = false
            const cancel = function () {
                isCanceled = true
            }
            events.emit('changing', { property, oldValue, newValue, cancel })

            if (isCanceled) {
                return
            }

            instance[property] = newValue

            // 如果不是新增，记录修改项
            if (status === 'original' || status === 'modified') {
                // 如果属性改回原样
                if (Reflect.has(origin, property) && (origin[property] === value)) {
                    if (modifieds.has(property)) {
                        modifieds.delete(property)
                    }

                    if (modifieds.size === 0) {
                        events.emit('reset')
                    }
                } else {
                    if (!modifieds.has(property)) {
                        modifieds.add(property)
                    }
                }
                if (status === 'original') {
                    status = 'modified'
                }
            }

            events.emit('changed', { property, oldValue, newValue })
        }
    }

    const instance = Object.create(prototype)


    // 初始化子属性
    for (const [prop, value] of Object.entries(origin)) {
        if (_.isPlainObject(value) || _.isArray(value)) {
            delete origin[prop]
            instance.$defineChild(prop, value)
        }
    }

    Object.assign(instance, origin)

    // 返回代理，监控属性设置
    return new Proxy(instance, {
        set(target, property, value) {
            instance.$set(property, value)
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

module.exports.new = function (data) {
    return createItem(data).$apply()
}
