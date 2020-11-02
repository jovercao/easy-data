import { EventEmitter } from 'events'
import { rootCertificates } from 'tls'
import { BaseType, Binary, isBaseType, isBinary, isProxyData } from './util'

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

export type Element<T extends Array<object>> = T extends Array<infer E> ? E : never

type ChangedProperty<T> = {
    oldValue: T
    newValue: T
}

export type ChangeData<T extends object> = {
    [P in keyof T]?: T[P] extends Set<any> | Map<any, any> ? never :
        T[P] extends Array<infer E> ? (E extends object ? ListMetadata<E> : ChangedProperty<T[P]>) :
        T[P] extends object ? ListMetadata<T[P]> :
        T[P] extends BaseType ? ChangedProperty<T[P]> : never
}

export const SYMBOLE_WATCHER = Symbol('#WATCHER')
// type SYMBOLE_WATCHER = typeof SYMBOLE_WATCHER

export type ProxyData<T extends object> = {
    [P in keyof T]: 
        T[P] extends Array<infer E> ? (E extends object ? List<E> : ChangedProperty<T[P]>) :
        T[P] extends Set<any> | Map<any, any> ? T[P] :
        T[P] extends object ? List<T[P]> : T[P]
} & {
    [SYMBOLE_WATCHER]: Watcher<T>;
}

type WatchProperty = {
    hasMany: boolean,
    list: List<any>
}

export class Watcher<T extends object = any> {
    /**
     * 修改数量
     */
    private _changedCount: number = 0

    private _emitter: EventEmitter
    /**
     * 当前状态
     */
    status: DataStatus

    readonly deepth: boolean

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
    readonly data: ProxyData<T>
    /**
     * 源数据对象，会随着数据变化而变化
     */
    readonly source: T

    private readonly _detailWatchers: {
        [property: string]: WatchProperty
        [property: number]: WatchProperty
    }

    private _initDetailWatcher(property: string | number, value: T | T[], status: DataStatus.New | DataStatus.Original): WatchProperty {
        let watcherInfo: {
            hasMany: boolean
            list: List<any>
        }
        if (Array.isArray(value)) {
            watcherInfo = this._detailWatchers[property] = {
                hasMany: true,
                list: status === DataStatus.New ? List.new(value) : List.origin(value)
            }
        } else {
            watcherInfo = this._detailWatchers[property] = {
                hasMany: false,
                list: status === DataStatus.New ? List.new([value], this.deepth) : List.origin([value], this.deepth)
            }
        }
        const handler = (event: string, target?: T, index?: number) => {
            this._emitter.emit('detailchange', {
                property: property,
                detailList: watcherInfo.list,
                event: 'add',
                target,
                index
            })
        }
        watcherInfo.list.on('add', (target, index) => {
            handler('add', target, index)
        }).on('change', (target, index) => {
            handler('change', target, index)
        }).on('delete', (target, index) => {
            handler('add', target, index)
        }).on('clean', () => {
            handler('clean')
        }).on('reset', () => {
            handler('reset')
        }).on('apply', () => {
            handler('apply')
        })

        return watcherInfo
    }

    private constructor(data: T, status: DataStatus.New | DataStatus.Original = DataStatus.Original, deepth: boolean = true) {        
        if (isBaseType(data)) {
            throw new Error('Invalid operation, data is not allowed to be the base type.')
        }
        if (data instanceof Map || data instanceof Set) {
            throw new Error('Unsupport to watch Map or Set object.')
        }

        this._emitter = new EventEmitter()
        this._changedValues = {}
        this.source = data
        this.status = status
        this._detailWatchers = {}
        this.deepth = deepth
        
        if (this.deepth) {
            // 初始化子属性监听
            Object.entries(this.source).forEach(([key, value]) => {
                if (!isBaseType(value)) {
                    this._initDetailWatcher(key, value, status)
                }
            })
        }
        this.data = new Proxy(data, {
            set: (target: T, property: string | number, value: any): boolean => {
                this._checkInvalid()
                if (this.status === DataStatus.Deleted) {
                    throw new Error('Do not allow modification of deleted data')
                }
                const oldValue = Reflect.get(target, property)
                const isBaseTypeValue = isBaseType(value)
                const existsProperty = !Reflect.has(target, property)
                if (existsProperty && isBaseTypeValue !== isBaseType(oldValue)) {
                    throw new Error('Invalid set opration, Donot allow change value type of property.')
                }

                /**
                 * 如果存在属性，并且是引用属性
                 */
                if (deepth && !isBaseTypeValue) {
                    if (existsProperty) {
                        let watcherInfo = this._detailWatchers[property]
                        if (!watcherInfo) {
                            throw new Error('Source is changed by outside Watcher! You have to make sure that all changes are made in the Watcher.')
                        }

                        if (!watcherInfo.hasMany && watcherInfo.list[0] !== value) {
                            watcherInfo.list.delete(watcherInfo.list[0])
                            watcherInfo.list.add(value)
                            return Reflect.set(target, property, value)
                        } else {
                            throw new Error(`Do not allow modification watched list property ${property}`)
                        }
                    }
                    // 原先不存在的，只能是新增
                    this._initDetailWatcher(property, value, DataStatus.New)
                }

                if (value !== oldValue) {
                    this._emitter.emit('change', target, property, oldValue, value)

                    if (this.status === DataStatus.Original || this.status === DataStatus.Modified) {
                        const hasOrigin = Reflect.has(this._changedValues, property)
                        if (!hasOrigin) {
                            this._changedValues[property] = oldValue
                            this._changedCount++
                            if (this.status === DataStatus.Original) {
                                this.status = DataStatus.Modified
                                this._emitter.emit('modify', target)
                            }
                        }
                        if (hasOrigin && this._changedValues[property] === value) {
                            Reflect.deleteProperty(this._changedValues, property)
                            this._changedCount--
                            if (this._changedCount === 0) {
                                this.status = DataStatus.Original
                                this._emitter.emit('reset', target)
                            }
                        }
                    }
                    return Reflect.set(target, property, value)
                }
                return true
            },

            get: (target: T, property: string | number | symbol): any => {
                if (property === SYMBOLE_WATCHER) {
                    return this
                }
                const value = Reflect.get(target, property)
                if (typeof property === 'symbol') {
                    return value
                }
                if (isBaseType(value)) {
                    return value
                }
                if (!deepth) {
                    return value
                }
                let watcherInfo = this._detailWatchers[property]
                if (!watcherInfo) {
                    throw new Error('Source is changed by outside Watcher! You have to make sure that all changes are made in the Watcher.')
                }
                if (watcherInfo.hasMany) {
                    return watcherInfo.list
                } else {
                    return watcherInfo.list[0]
                }
            }
        }) as ProxyData<T>
    }

    static new<T extends object>(data: T, deepth = true) {
        return new Watcher(data, DataStatus.New, deepth)
    }

    static origin<T extends object>(data: T, deepth = true) {
        return new Watcher(data, DataStatus.Original, deepth)
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
        // 重置所有明细
        if (this.deepth) {
            for (const watcher of Object.values(this._detailWatchers)) {
                watcher.list.reset()
            }
        }
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
        // 提交明细
        if (this.deepth) {
            for (const watcher of Object.values(this._detailWatchers)) {
                watcher.list.apply()
            }
        }
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
        // 删除所有明细
        if (this.deepth) {
            for (const watcher of Object.values(this._detailWatchers)) {
                watcher.list.clean()
            }
        }
        this._checkInvalid()
        this._resetValue()
        this.status = DataStatus.Deleted
        this._emitter.emit('delete', this.source)
    }

    /**
     * 获取被修改的属性,当状态modified和deleted时有返回值
     */
    getChanges(): ChangeData<T> {
        this._checkInvalid()
        const changeds: ChangeData<T> = {} 
        if (this.status === DataStatus.New) {
            Object.entries(this.source).forEach(([key, value]) => {
                Reflect.set(changeds, key, {
                    oldValue: undefined,
                    newValue: value
                })
            })
        } else {
            Object.keys(this._changedValues).forEach(key => {
                Reflect.set(changeds, key, {
                    oldValue: this._changedValues[key],
                    newValue: Reflect.get(this.source, key)
                })
            })
        }
        if (this.deepth) {
            Object.entries(this._detailWatchers).forEach(([key, watcher]) => {
                Reflect.set(changeds, key, watcher.list.getMetadata())
            })
        }
        return changeds
    }
}

/**
 * 变更项
 */
export type ChangedItem<T extends object> = {
    // 当前项内容
    item: T;
    // 修改项
    changes: ChangeData<T>;
}

export interface ListMetadata<T extends object> {
    /**
     * 添加的项
     */
    addeds: ChangedItem<T>[];
    /**
     * 修改的项
     */
    modifieds: ChangedItem<T>[];
    /**
     * 被删除的项
     */
    deleteds: ChangedItem<T>[];
    /**
     * 未修改的项
     */
    originals: ChangedItem<T>[];
}


export class List<T extends object = any> implements Iterable<T> {
    private _count: number = 0
    readonly [index: number]: T
    private readonly _emitter: EventEmitter

    *[Symbol.iterator](): Iterator<T> {
        for (let i = 0; i < this._count; i++) {
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

    readonly deepth: boolean

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
        return this._count
    }

    get isChanged() {
        return this._addedCount > 0 || this._deletedCount > 0 || this._modifiedCount > 0
    }

    private constructor(datas: T[], status: DataStatus.New | DataStatus.Original = DataStatus.Original, deepth = true) {
        this._emitter = new EventEmitter
        /**
         * 视图查看时的项
         */
        this._viewItems = Array.from(datas)
        this._watchers = new Map<T, Watcher<T>>()
        this._allItems = new Map<T, number>()

        this.deepth = deepth
        // 原始顺序，用于reset重置
        this._originsItems = Array.from(datas)
        this._viewItems.forEach((item, index) => this._allItems.set(item, index))
        for (let i = 0; i < this._viewItems.length; i++) {
            this._bind(this._viewItems[i], status)
            this._attach(i)
        }
    }

    static origin<T extends object>(datas: T[], deepth = true) {
        return new List(datas, DataStatus.Original, deepth)
    }

    static new<T extends object>(datas: T[], deepth = true) {
        return new List(datas, DataStatus.New, deepth)
    }

    private _updateIndexes() {
        if (this._count > this._viewItems.length) {
            for (let i = this._count - 1; i >= this._viewItems.length - 1; i--) {
                this._disattach(i)
            }
        } else if (this._count < this._viewItems.length) {
            for (let i = this._count; i < this._viewItems.length; i++) {
                this._attach(i)
            }
        }
        this._count = this._viewItems.length
    }

    /**
     * 对视图进行排序
     */
    sort(compare?: <T>(a: T, b: T) => number) {
        this._viewItems.sort(compare)
    }

    /**
     * 将项附着到List中
     */
    private _attach(index: number) {
        Reflect.defineProperty(this, index, {
            get: () => {
                const item = this._viewItems[index]
                const watcher = this._watchers.get(item)
                if (!watcher) {
                    throw new Error('Internal Error')
                }
                return watcher.data
            },
            set() {
                throw new Error('List index is readonly, use add/delete to instead.')
            }
        })
    }

    private _disattach(index: number) {
        Reflect.deleteProperty(this, index)
    }

    private _bind(item: T, status: DataStatus.New | DataStatus.Original) {
        let watcher: Watcher<T>
        if (status === DataStatus.New) {
            watcher = Watcher.new(item, this.deepth)
        } else {
            watcher = Watcher.origin(item, this.deepth)
        }
        this._watchers.set(item, watcher)
        // this._watchers.set(watcher.data, watcher)
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
                    this._unbind(item)
                    this._updateIndexes()
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
                    const resetIndex = Math.min(<number>this._allItems.get(item), this._count)
                    this._viewItems.splice(resetIndex, 0, item)
                    this._allItems.set(item, resetIndex)
                    this._emitter.emit('add', item, resetIndex)
                    this._updateIndexes()
                    this._deletedCount--;
                    break;
                case DataStatus.Modified:
                    this._emitter.emit('change', item, this._viewItems.indexOf(item))
                    this._modifiedCount--;
                    break;
                case DataStatus.New:
                    this._addedCount--;
                    this._unbind(item)
                    this._updateIndexes()
                    break;
            }
        })

        watcher.on('delete', (item) => {
            if (this._cleaning) return
            const index = this._viewItems.indexOf(item)
            this._viewItems.splice(index, 1)
            this._deletedCount++
            this._updateIndexes()
            this._emitter.emit('delete', item, index)
        })
    }

    // 清理多余的项
    private _unbind(item: T) {
        const watcher = <Watcher<T>>this._watchers.get(item)
        watcher.off('change')
        watcher.off('modify')
        watcher.off('apply')
        watcher.off('reset')
        watcher.off('delete')
        this._allItems.delete(item)
        // 删除watcher
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
            this._updateIndexes()
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
                        this._unbind(item)
                    }
                }
                this._originsItems = Array.from(this._viewItems)
                this._addedCount = 0
                this._deletedCount = 0
                this._modifiedCount = 0
                this._updateIndexes()
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
                        this._unbind(item)
                    }
                }
                this._addedCount = 0
                this._deletedCount = 0
                this._modifiedCount = 0
                this._viewItems = Array.from(this._originsItems)
                this._updateIndexes()
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
            index = this._count
        } else {
            if (index < 0 || index > this._count) {
                throw new Error('Out of range: index')
            }
        }
        this._viewItems.splice(index, 0, item)
        this._allItems.set(item, index)
        this._bind(item, DataStatus.New)
        this._addedCount++
        this._updateIndexes()
        this._emitter.emit('add', item, index)
        return this[index]
    }

    delete(item: T): boolean
    delete(item: ProxyData<T>): boolean
    delete(index: number): boolean
    delete(args: T | ProxyData<T> | number): boolean {
        let item: T
        if (typeof args === 'number') {
            item = this._viewItems[args]
        } else if (isProxyData(args)) {
            item = args[SYMBOLE_WATCHER].source
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
                this._updateIndexes()
                this._emitter.emit('delete', item, index)
            }
        } else {
            watcher.delete()
        }
        return true
    }

    getWatcher(data: T): Watcher<T>
    getWatcher(data: ProxyData<T>): Watcher<T>
    getWatcher(data: T | ProxyData<T>): Watcher<T> {
        if (isProxyData(data)) {
            return data[SYMBOLE_WATCHER]
        }
        const watcher = this._watchers.get(data)
        if (!watcher) {
            throw new Error('Out of range')
        }
        return watcher
    }

    getMetadata(): ListMetadata<T> {
        const list = Array.from(this._allItems.keys())
        return {
            addeds: list.filter((item) => {
                const watcher = this._watchers.get(item)
                return watcher && watcher.status === DataStatus.New
            }).map(item => {
                const watcher = this._watchers.get(item)
                return {
                    item,
                    changes: (watcher as Watcher<T>).getChanges()
                }
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
            }).map(item => {
                const watcher = this._watchers.get(item)
                return {
                    item,
                    changes: (watcher as Watcher<T>).getChanges()
                }
            }),
            originals: list.filter(item => {
                const watcher = this._watchers.get(item)
                return !watcher || watcher.status === DataStatus.Original
            }).map(item => {
                const watcher = this._watchers.get(item)
                return {
                    item,
                    changes: (watcher as Watcher<T>).getChanges()
                }
            })
        }
    }
}

/**
 * 监听数据列表
 * @param items 数据项
 * @param deepth 是否递归watch，默认为false
 */
export function watch<T extends object>(items: T[], deepth?: boolean): List<T>
/**
 * 监听数据项
 * @param item 数据项
 * @param deepth 是否递归监听
 */
export function watch<T extends object>(item: T, deepth?: boolean): Watcher<T>
export function watch<T extends object>(args: T[] | T, deepth = true): Watcher<T> | List<T> {
    if (args instanceof Array) {
        return List.origin(args, deepth)
    }
    return Watcher.origin(args, deepth)
}

export default watch
