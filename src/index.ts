import _ = require('lodash')
import { EventEmitter } from 'events'
import { EMFILE } from 'constants'

/**
 * 当前数据状态
 */
export enum DataStatus {
    /**
     * 无效的，废弃的
     */
    Invalid = 'invalid',
    /**
     * 原始的，未修改的
     */
    Original = 'original',
    /**
     * 新建的
     */
    New = 'new',
    /**
     * 被修改过的
     */
    Modified = 'modified',
    /**
     * 被删除的
     */
    Deleted = 'deleted'
}

export class Watcher<T extends object> {
    /**
     * 修改数量
     */
    private _changedCount: number = 0

    private _emitter: EventEmitter
    /**
     * 当前状态
     */
    status: DataStatus = DataStatus.Original

    /**
     * 被修改过的属性的原始值将存在该对象中
     */
    private readonly _changedValues: {
        [key: string]: any
        [key: number]: any
    }

    /**
     * 代理后的对象，想要受到监控使用该对象
     */
    readonly data: T
    readonly source: T

    private constructor(data: T, status: DataStatus.New | DataStatus.Original) {
        this._emitter = new EventEmitter()
        this._changedValues = {}
        this.source = data
        this.status = status
        this.data = new Proxy(data, {
            set: (target: T, property: string | number, value: any): boolean => {
                this._checkInvalid()
                if (this.status === DataStatus.Deleted) {
                    throw new Error('Do not allow modification of deleted data')
                }
                const oldValue = Reflect.get(target, property)
                if (value !== oldValue) {
                    this._emitter.emit('change', target, property, oldValue, value)

                    if (this.status === DataStatus.Original || this.status === DataStatus.Modified) {
                        const hasOrigin = Reflect.has(this._changedValues, property)
                        if (!hasOrigin) {
                            this._changedValues[property] = oldValue
                            this._changedCount++
                            if (this.status === DataStatus.Original) {
                                this.status = DataStatus.Modified
                                this._emitter.emit('modify', this.source)
                            }
                        }
                        if (hasOrigin && this._changedValues[property] === value) {
                            Reflect.deleteProperty(this._changedValues, property)
                            this._changedCount--
                            if (this._changedCount === 0) {
                                this.status = DataStatus.Original
                                this._emitter.emit('reset', this.source)
                            }
                        }
                    }
                }
                return Reflect.set(target, property, value)
            }
        })
    }

    static new<T extends object>(data: T) {
        return new Watcher(data, DataStatus.New)
    }

    static origin<T extends object>(data: T) {
        return new Watcher(data, DataStatus.Original)
    }

    /**
     * 当值被应用时触发
     * @param event 
     * @param handler 
     */
    on(event: 'apply', handler: (target: T, oldStatus: DataStatus) => void): this
    /**
     * 值被重置到初始状态
     * @param event 
     * @param handler 
     */
    on(event: 'reset', handler: (target: T, oldStatus: DataStatus) => void): this
    /**
     * 当data对象相较于原始状态发生变化时触发该事件
     * @param event 
     * @param handler 
     */
    on(event: 'modify', handler: (target: T) => void): this
    /**
     * 当属性被修改时触发
     * @param event 
     * @param handler 
     */
    on(event: 'change', handler: (target: T, property: keyof T, oldValue: any, newValue: any) => void): this
    /**
     * 当该记录被记录集删除时触发
     * @param event 
     * @param handler 
     */
    on(event: 'delete', handler: (target: T) => void): this
    on(event: string, handler: (...args: any[]) => void): this {
        this._emitter.on(event, handler)
        return this
    }

    off(event: 'apply', handler: (target: T) => void): this
    off(event: 'reset', handler: (target: T) => void): this
    off(event: 'modify', handler: (target: T) => void): this
    off(event: 'delete', handler: (target: T) => void): this
    off(event: 'change', handler: (target: T, property: keyof T, oldValue: any, newValue: any) => void): this
    off(event: 'apply'): this
    off(event: 'reset'): this
    off(event: 'modify'): this
    off(event: 'delete'): this
    off(event: 'change'): this
    off(event: string, handler?: (...args: any[]) => void): this {
        if (!handler) {
            this._emitter.removeAllListeners()
        } else {
            this._emitter.off(event, handler)
        }
        return this
    }

    private _checkInvalid() {
        if (this.status === DataStatus.Invalid) throw new Error('Invalid action, Data has been marked invalid.')
    }

    private _resetValue() {
        for (const [key, value] of Object.entries(this._changedValues)) {
            Reflect.set(this.source, key, value)
            Reflect.deleteProperty(this._changedValues, key)
        }
    }

    reset() {
        this._checkInvalid()
        const oldStatus = this.status
        switch (this.status) {
            case DataStatus.Original:
                return
            case DataStatus.Modified:
            case DataStatus.Deleted:
                this._resetValue()
                this.status = DataStatus.Original
                break
            case DataStatus.New:
                this.status = DataStatus.Invalid
                break
        }
        this._emitter.emit('reset', this.source, oldStatus)
    }

    apply() {
        this._checkInvalid()
        if (this.status === DataStatus.Original) return

        for (const key of Object.keys(this._changedValues)) {
            Reflect.deleteProperty(this._changedValues, key)
        }
        const oldStatus = this.status
        switch (this.status) {
            case DataStatus.Deleted:
                this.status = DataStatus.Invalid
                break
            default:
                this.status = DataStatus.Original
                break
        }
        this._emitter.emit('apply', this.source, oldStatus)
    }

    /**
     * 删除项，如果项之前被修改过，则其会恢复成修改前的状态并删除
     */
    delete() {
        this._checkInvalid()
        this._resetValue()
        this.status = DataStatus.Deleted
        this._emitter.emit('delete', this.source)
    }

    /**
     * 获取被修改的属性,当状态modified和deleted时有返回值
     */
    getChanges() {
        this._checkInvalid()
        if (this.status === DataStatus.New) {
            return Object.entries(this.source).map(([key, value]) => ({
                property: key,
                oldValue: undefined,
                newValue: value
            }))
        }
        return Object.keys(this._changedValues).map(key => ({
            property: key,
            oldValue: this._changedValues[key],
            newValue: Reflect.get(this.source, key)
        }))
    }
}


export interface ListMetadata<T extends object> {
    addeds: T[];
    modifieds: {
        item: T;
        changes: {
            property: string;
            oldValue: any;
            newValue: any;
        }[];
    }[];
    deleteds: T[];
    originals: T[];
}

export class List<T extends object> implements Iterable<T> {
    _length: number = 0
    readonly [index: number]: T
    private readonly _emitter: EventEmitter

    *[Symbol.iterator](): Iterator<T> {
        for (let i = 0; i < this._length; i++) {
            yield this[i]
        }
    }

    private readonly _watchers: Map<T, Watcher<T>>

    private readonly _allItems: Map<T, number>
    private _viewItems: T[]
    private _originsItems: T[]

    private _applying: boolean = false
    private _resetting: boolean = false
    private _cleaning: boolean = false

    private _addedCount: number = 0
    private _deletedCount: number = 0
    private _modifiedCount: number = 0

    get length() {
        return this._length
    }

    get addedCount() {
        return this._addedCount
    }

    get deletedCount() {
        return this._deletedCount
    }

    get modifiedCount() {
        return this._modifiedCount
    }

    get count() {
        return this._length
    }

    get isChanged() {
        return this._addedCount > 0 || this._deletedCount > 0 || this._modifiedCount > 0
    }

    constructor(datas: T[]) {
        this._emitter = new EventEmitter
        /**
         * 视图查看时的项
         */
        this._viewItems = Array.from(datas)
        this._watchers = new Map<T, Watcher<T>>()
        this._allItems = new Map<T, number>()

        // 原始顺序，用于reset重置
        this._originsItems = Array.from(datas)
        this._viewItems.forEach((item, index) => this._allItems.set(item, index))
        this._updateLength()
    }

    private _updateLength() {
        if (this._length > this._viewItems.length) {
            for (let i = this._length - 1; i >= this._viewItems.length - 1; i--) {
                this._unwatch(i)
            }
        } else if (this._length < this._viewItems.length) {
            for (let i = this._length; i < this._viewItems.length; i++) {
                this._watch(i)
            }
        }
        this._length = this._viewItems.length
    }

    private _watch(index: number) {
        /**
         * 延迟加载watcher以优化性能
         */
        Reflect.defineProperty(this, index, {
            get: () => {
                const item = this._viewItems[index]
                let watcher = this._watchers.get(item)
                if (!watcher) {
                    watcher = Watcher.origin(item)
                    this._watchers.set(item, watcher)
                    this._watchers.set(watcher.data, watcher)
                    this._bind(watcher)
                }
                return watcher.data
            },
            set(v) {
                throw new Error('List item is readonly.')
            }
        })
    }

    private _unwatch(index: number) {
        Reflect.deleteProperty(this, index)
    }

    private _bind(watcher: Watcher<T>) {
        watcher.on('change', (item) => {
            this._emitter.emit('change', item, this._viewItems.indexOf(item))
        })
        watcher.on('modify', (item) => {
            this._modifiedCount++
        })
        watcher.on('apply', (item, oldStatus) => {
            if (this._applying) return
            switch (oldStatus) {
                case DataStatus.Deleted:
                    this._clearInvalid(item)
                    this._deletedCount--;
                    break;
                case DataStatus.Modified:
                    this._modifiedCount--;
                    break;
                case DataStatus.New:
                    this._addedCount--;
                    break;
            }
        })
        watcher.on('reset', (item, oldStatus) => {
            if (this._resetting) return
            switch (oldStatus) {
                case DataStatus.Deleted:
                    const resetIndex = Math.min(<number>this._allItems.get(item), this._length)
                    this._viewItems.splice(resetIndex, 0, item)
                    this._allItems.set(item, resetIndex)
                    this._emitter.emit('add', watcher.data, resetIndex)
                    this._updateLength()
                    this._deletedCount--;
                    break;
                case DataStatus.Modified:
                    this._emitter.emit('change', watcher.data, this._viewItems.indexOf(item))
                    this._modifiedCount--;
                    break;
                case DataStatus.New:
                    this._addedCount--;
                    this._clearInvalid(item)
                    break;
            }
        })

        watcher.on('delete', (item) => {
            if (this._cleaning) return
            const index = this._viewItems.indexOf(item)
            this._viewItems.splice(index, 1)
            this._deletedCount++
            this._updateLength()
            this._emitter.emit('delete', watcher.data, index)
        })
    }

    private _clearInvalid(item: T) {
        // 清理缓存
        const watcher = <Watcher<T>>this._watchers.get(item)
        watcher.off('change')
        watcher.off('modify')
        watcher.off('apply')
        watcher.off('reset')
        watcher.off('delete')
        this._allItems.delete(item)
        // 删除watcher
        this._watchers.delete(watcher.data)
        this._watchers.delete(item)
    }

    on(event: 'change', handler: (item: T, index: number) => void): this
    on(event: 'reset', handler: () => void): this
    on(event: 'clean', handler: () => void): this
    on(event: 'apply', handler: () => void): this
    on(event: 'add', handler: (item: T, index: number) => void): this
    on(event: 'delete', handler: (item: T, index: number) => void): this
    on(event: string, handler: (...args: any) => void): this {
        this._emitter.on(event, handler)
        return this
    }

    off(event: 'change', handler?: (item: T, index: number) => void): this
    off(event: 'reset', handler?: () => void): this
    off(event: 'clean', handler?: () => void): this
    off(event: 'apply', handler?: () => void): this
    off(event: 'add', handler?: (item: T, index: number) => void): this
    off(event: 'delete', handler?: (item: T, index: number) => void): this
    off(event: string, handler?: (...args: any) => void): this {
        if (handler) {
            this._emitter.off(event, handler)
        } else {
            this._emitter.removeAllListeners(event)
        }
        return this
    }

    clean() {
        this._cleaning = true
        try {
            for (const item of this._viewItems) {
                this.delete(item)
            }
            this._viewItems = []
            this._updateLength()
            this._emitter.emit('clean')
        }
        finally {
            this._cleaning = false
        }
    }

    /**
     * 重置所有项
     */
    apply(): void
    /**
     * 重置指定索引的项
     * @param index 
     */
    apply(index: number): void
    /**
     * 重置指定的项
     * @param item 
     */
    apply(item: T): this
    apply(args?: number | T): this {
        let item: T | undefined
        if (typeof args === 'number') {
            item = this._viewItems[args]
        } else {
            item = args
        }

        if (item) {
            if (!this._allItems.get(item)) {
                throw new Error('Item that do not exist of the list')
            }
            const watcher = this._watchers.get(item)
            if (watcher) {
                watcher.apply()
            }
        } else {
            this._applying = true
            try {
                for (const [item, watcher] of this._watchers.entries()) {
                    watcher.apply()
                    if (watcher.status === DataStatus.Invalid) {
                        this._clearInvalid(item)
                    }
                }
                this._originsItems = Array.from(this._viewItems)
                this._addedCount = 0
                this._deletedCount = 0
                this._modifiedCount = 0
            } finally {
                this._applying = false
            }
        }
        return this
    }

    /**
     * 重置所有项
     */
    reset(): this
    /**
     * 重置指定索引的项
     * @param index 
     */
    reset(index: number): this
    /**
     * 重置指定的项
     * @param item 
     */
    reset(item: T): this
    reset(arg?: number | T): this {
        let item: T | undefined = undefined
        if (typeof arg === 'number') {
            item = this._viewItems[arg]
        }
        if (typeof arg === 'object') {
            item = arg
        }

        if (item) {
            if (!this._allItems.get(item)) {
                throw new Error('Item that do not exist of the list')
            }
            const watcher = this._watchers.get(item)
            if (watcher) watcher.reset()
        } else {
            this._resetting = true
            try {
                for (const [item, watcher] of this._watchers.entries()) {
                    watcher.reset()
                    if (watcher.status === DataStatus.Invalid) {
                        this._clearInvalid(item)
                    }
                }
                this._addedCount = 0
                this._deletedCount = 0
                this._modifiedCount = 0
                this._viewItems = Array.from(this._originsItems)
                this._updateLength()
            } finally {
                this._resetting = false
            }
        }
        return this
    }

    /**
     * 添加一个项，并返回该项已Watch的值
     * @param item 项
     * @param index 要插入的索引
     */
    add(item: T, index?: number): T {
        if (this._allItems.has(item)) {
            throw new Error('Invalid action, item is watching in list.')
        }
        if (index === undefined) {
            index = this._length
        } else {
            if (index < 0 || index > this._length) {
                throw new Error('Out of range: index')
            }
        }
        this._viewItems.splice(index, 0, item)
        this._allItems.set(item, index)
        const watcher = Watcher.new(item)
        this._watchers.set(item, watcher)
        this._watchers.set(watcher.data, watcher)
        this._bind(watcher)
        this._addedCount++
        this._updateLength()
        this._emitter.emit('add', this[index], index)
        return this[index]
    }

    delete(item: T): boolean
    delete(index: number): boolean
    delete(args: T | number): boolean {
        let item: T
        if (typeof args === 'number') {
            item = this._viewItems[args]
        } else {
            item = args
        }
        if (!item) {
            throw new Error('Out of range')
        }
        const watcher = this._watchers.get(item)

        if (!watcher) {
            if (!this._cleaning) {
                const index = this._viewItems.indexOf(item)
                this._viewItems.splice(index, 1)
                this._deletedCount++
                this._updateLength()
                this._emitter.emit('delete', item, index)
            }
        } else {
            watcher.delete()
        }
        return true
    }

    getMetadata(): ListMetadata<T> {
        const list = Array.from(this._allItems.keys())
        return {
            addeds: list.filter((item) => {
                const watcher = this._watchers.get(item)
                return watcher && watcher.status === DataStatus.New
            }),
            modifieds: list.filter(item => {
                const watcher = this._watchers.get(item)
                return watcher && watcher.status === DataStatus.Modified
            }).map(item => {
                const watcher = this._watchers.get(item)
                return {
                    item,
                    changes: (watcher as Watcher<T>).getChanges()
                }
            }),
            deleteds: list.filter(item => {
                const watcher = this._watchers.get(item)
                return watcher && watcher.status === DataStatus.Deleted
            }),
            originals: list.filter(item => {
                const watcher = this._watchers.get(item)
                return !watcher || watcher.status === DataStatus.Original
            })
        }
    }
}

export function watch<T extends object>(items: T[]): List<T>
export function watch<T extends object>(item: T): Watcher<T>
export function watch<T extends object>(args: T[] | T) {
    if (args instanceof Array) {
        return new List(args)
    }
    return Watcher.new(args)
}

export default watch
