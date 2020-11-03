import { profileEnd } from 'console'
import { EventEmitter } from 'events'
import { rootCertificates } from 'tls'
import { BaseType, Binary, isBaseType, isBinary, isProxyData, isUnspportedType } from './util'

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

export const SYMBOLE_WATCHER = Symbol('#WATCHER')
// type SYMBOLE_WATCHER = typeof SYMBOLE_WATCHER


type SubListPropertiesOf<T> = {
    [P in keyof T]:
        NonNullable<T[P]> extends BaseType | Map<any, any> | Set<any> ? never :
        NonNullable<T[P]> extends object[] ? P : never
}[keyof T]

type SubItemPropertiesOf<T> = {
    [P in keyof T]:
        NonNullable<T[P]> extends BaseType | Map<any, any> | Set<any> ? never :
        NonNullable<T[P]> extends object[] ? never : P
}[keyof T]

/**
 * 获取明细属性列表
 */
type WatchPropertiesOf<T> = SubListPropertiesOf<T> | SubItemPropertiesOf<T>

type WatchProperty = {
    hasMany: boolean,
    list: List<any>
}

/**
 * 基础属性
 */
type BasePropertiesOf<T> = Exclude<keyof T, WatchPropertiesOf<T>>

export type ProxyData<T extends object> = {
    /**
     * 基础属性，包括Map/Set等不支持watch的属性
     */
    [P in BasePropertiesOf<T>]: T[P]
} & {
    /**
     * 子列表属性
     */
    readonly [P in SubListPropertiesOf<T>]: NonNullable<T[P]> extends Array<infer E> ? (E extends object ? List<E> : never) : never
} & {
    /**
     * 子对象属性
     */
    [P in SubItemPropertiesOf<T>]: NonNullable<T[P]> extends object ? ProxyData<NonNullable<T[P]>> | T[P] : never
} & {
    [SYMBOLE_WATCHER]: Watcher<T>;
}


type ChangedProperty<T> = {
    oldValue: T
    newValue: T
}

export type ChangeData<T extends object> = {
    /**
     * 基础属性，包括Map/Set等不支持watch的属性
     */
    readonly [P in BasePropertiesOf<T>]?: T[P]
} & {
    /**
     * 子列表属性
     */
    readonly [P in SubListPropertiesOf<T>]?: NonNullable<T[P]> extends Array<infer E> ? (E extends object ? ListMetadata<E> : never) : never
} & {
    /**
     * 子对象属性
     */
    readonly [P in SubItemPropertiesOf<T>]?: NonNullable<T[P]> extends object ? ChangeData<NonNullable<T[P]>> | T[P] : never
}

export type WatcherChangeEventHandler<T> = <P extends keyof T>(target: T, property: P, oldValue: T[P], newValue: T[P]) => void
export type WatcherSubChangeEventHandler<T> = <P extends keyof T>(target: T, property: P, subEvent: {
    event: 'add' | 'delete' | 'change' | 'reset' | 'apply' | 'clean',
    target?: T[P],
    index?: number
}) => void

export type ItemEventHandler<T> = (target: T) => void;
export type EmptyEventHandler<T> = () => void;

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

    /**
     * 值变更事件
     */
    private _onChange(property: string | number, oldValue?: any, newValue?: any) {
        
        this._emitter.emit('change', this.source, property, oldValue, newValue)

        // if (watchProperty.hasMany) {
        //     this._emitter.emit('change', this.source, property, watchProperty.list.source, watchProperty.list.source)
        // } else {
        //     this._emitter.emit('change', this.source, property, watchProperty.list.getDeleteds()[0], watchProperty.list.source[0])
        // }

        if (!(this.status === DataStatus.Original || this.status === DataStatus.Modified)) {
            return
        }
        const watchProperty = this._detailWatchers[property]

        const hasOrigin = Reflect.has(this._changedValues, property)
        if (!hasOrigin) {
            this._changedValues[property] = watchProperty ? true : oldValue
            this._changedCount++
            if (this.status === DataStatus.Original) {
                this.status = DataStatus.Modified
                this._emitter.emit('modify', this.source)
            }
        }
        else if (watchProperty ? watchProperty.list.isChanged : this._changedValues[property] === newValue) {
            Reflect.deleteProperty(this._changedValues, property)
            this._changedCount--
            if (this._changedCount === 0) {
                this.status = DataStatus.Original
                this._emitter.emit('reset', this.source)
            }
        }
    }

    private _createItemWatcher(property: string | number, value: T | T[], status: DataStatus.New | DataStatus.Original): WatchProperty {
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
            this._emitter.emit('subchange', this.source, property, {
                event,
                target,
                index
            })
        }
        watcherInfo.list.on('add', (target, index) => {
            handler('add', target, index)
        }).on('change', (target, index) => {
            handler('change', target, index)
        }).on('delete', (target, index) => {
            handler('delete', target, index)
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
                    this._createItemWatcher(key, value, status)
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
                 * 如果存在属性，并且是引用属性，并且不是不支持的类型
                 */
                if (deepth && !isBaseTypeValue && !isUnspportedType(value)) {
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
                    // 原先不存在的，初始化监听
                    this._createItemWatcher(property, value, DataStatus.New)
                }

                if (oldValue !== value) {
                    this._onChange(property, oldValue, value)
                }
                // 值不变或者不支持的类型
                return Reflect.set(target, property, value)
            },

            get: (target: T, property: string | number | symbol): any => {
                if (property === SYMBOLE_WATCHER) {
                    return this
                }
                const value = Reflect.get(target, property)
                // // 不支持的类型，直接默认操作
                // if (!deepth || typeof property === 'symbol' || isBaseType(value) || isUnspportedType(value)) {
                //     return value
                // }
                if (this.deepth && typeof property !== 'symbol' && !isBaseType(value) && !isUnspportedType(value)) {
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
                return value
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
    on(event: 'change', handler: WatcherChangeEventHandler<T>): this
    /**
     * 当该记录被记录集删除时触发
     * @param event 
     * @param handler 
     */
    on(event: 'delete', handler: (target: T) => void): this
    /**
     * 当明细子属性发生变化时触发
     * @param event 
     * @param handler
     */
    on(event: 'subchange', handler: WatcherSubChangeEventHandler<T>): this
    on(event: string, handler: (...args: any[]) => void): this {
        this._emitter.on(event, handler)
        return this
    }

    off(event: 'apply', handler?: (target: T) => void): this
    off(event: 'reset', handler?: (target: T) => void): this
    off(event: 'modify', handler?: (target: T) => void): this
    off(event: 'delete', handler?: (target: T) => void): this
    off(event: 'change', handler?: WatcherChangeEventHandler<T>): this
    off(event: 'subchange', handler?: WatcherSubChangeEventHandler<T>): this
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
        this._checkInvalid()
        this._resetValue()
        if (this.deepth) {
            for (const watcher of Object.values(this._detailWatchers)) {
                watcher.list.clean()
            }
        }
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
    /**
     * 当前项内容
     */
    item: T;
    /**
     * 修改项，明细表的更改也在此属性中
     */
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

/**
 * Watcher列表
 */
export class List<T extends object = any> implements Iterable<T> {
    readonly count: number = 0
    readonly [index: number]: T
    private readonly _emitter: EventEmitter

    *[Symbol.iterator](): Iterator<T> {
        for (let i = 0; i < this.count; i++) {
            yield this[i]
        }
    }

    private readonly _watchers: Map<T, Watcher<T>>

    private readonly _allItems: Map<T, number>
    /**
     * 数据源对象
     */
    source: T[]
    /**
     * 数组原始顺序，用于reset
     */
    private _origins: T[]

    /**
     * 是否在应用变更当中
     */
    private _applying: boolean = false
    /**
     * 是否在重置当中
     */
    private _resetting: boolean = false
    /**
     * 是否在清空执行当中
     */
    private _cleaning: boolean = false

    /**
     * 已添加的项
     */
    private _addedCount: number = 0
    /**
     * 已删除的项
     */
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

    get isChanged() {
        return this._addedCount > 0 || this._deletedCount > 0 || this._modifiedCount > 0
    }

    private constructor(datas: T[], status: DataStatus.New | DataStatus.Original = DataStatus.Original, deepth = true) {
        this._emitter = new EventEmitter
        /**
         * 视图查看时的项
         */
        this.source = datas
        this._watchers = new Map<T, Watcher<T>>()
        this._allItems = new Map<T, number>()

        this.deepth = deepth
        // 原始顺序，用于reset重置
        this._origins = Array.from(datas)
        this.source.forEach((item, index) => this._allItems.set(item, index))
        for (let i = 0; i < this.source.length; i++) {
            this._bind(this.source[i], status)
            this._attach(i)
        }
    }

    static origin<T extends object>(datas: T[], deepth = true) {
        return new List(datas, DataStatus.Original, deepth)
    }

    static new<T extends object>(datas: T[], deepth = true) {
        return new List(datas, DataStatus.New, deepth)
    }

    /**
     * 维护List索引
     */
    private _updateIndexes() {
        if (this.count > this.source.length) {
            for (let i = this.count - 1; i >= this.source.length - 1; i--) {
                this._disattach(i)
            }
        } else if (this.count < this.source.length) {
            for (let i = this.count; i < this.source.length; i++) {
                this._attach(i)
            }
        }
        Reflect.set(this, 'count', this.source.length)
    }

    /**
     * 对视图进行排序
     */
    sort(compare?: <T>(a: T, b: T) => number) {
        this.source.sort(compare)
    }

    /**
     * 将项附着到List中
     */
    private _attach(index: number) {
        Reflect.defineProperty(this, index, {
            get: () => {
                const item = this.source[index]
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

    /**
     * 将源数据项绑定到List中，
     */
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
            this._emitter.emit('change', item, this.source.indexOf(item))
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
                    const resetIndex = Math.min(<number>this._allItems.get(item), this.count)
                    this.source.splice(resetIndex, 0, item)
                    this._allItems.set(item, resetIndex)
                    this._emitter.emit('add', item, resetIndex)
                    this._updateIndexes()
                    this._deletedCount--;
                    break;
                case DataStatus.Modified:
                    this._emitter.emit('change', item, this.source.indexOf(item))
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
            const index = this.source.indexOf(item)
            this.source.splice(index, 1)
            this._deletedCount++
            this._updateIndexes()
            this._emitter.emit('delete', item, index)
        })
    }

    /**
     * 将项解除绑定
     */
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

    /**
     * 清空所有项
     */
    clean() {
        this._cleaning = true
        try {
            for (const item of this.source) {
                this.delete(item)
            }
            this.source.length = 0
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
    apply(): this
    /**
     * 重置指定索引的项
     * @param index 
     */
    apply(index: number): this
    /**
     * 应用指定的项
     * @param item 
     */
    apply(item: T): this
    /**
     * 应用指定的项
     * @param item 
     */
    apply(item: ProxyData<T>): this
    apply(args?: number | T | ProxyData<T>): this {
        if (args) {
            let item: T
            if (typeof args === 'number') {
                item = this.source[args]
            } else if (isProxyData(args)) {
                item = args[SYMBOLE_WATCHER].source
            } else {
                item = args
            }

            const watcher = this._watchers.get(item)
            if (!watcher) {
                throw new Error('Out of range, item is not in the List.')
            }
            watcher.apply()
            return this
        }

        this._applying = true
        try {
            for (const [item, watcher] of this._watchers.entries()) {
                watcher.apply()
                if (watcher.status === DataStatus.Invalid) {
                    this._unbind(item)
                }
            }
            this._origins = Array.from(this.source)
            this._addedCount = 0
            this._deletedCount = 0
            this._modifiedCount = 0
            this._updateIndexes()
        } finally {
            this._applying = false
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
    reset(item: ProxyData<T>): this
    reset(arg?: number | T | ProxyData<T>): this {
        if (arg) {
            let item: T | undefined = undefined
            if (typeof arg === 'number') {
                item = this.source[arg]
            } else if (isProxyData(arg)) {
                item = arg[SYMBOLE_WATCHER].source
            } else {
                item = arg
            }
            const watcher = this._watchers.get(item)
            if (!watcher) {
                throw new Error('Out of range, item is not in then List.')
            }
            watcher.reset()
            return this
        }

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
            this.source.length = this._origins.length
            this._origins.forEach((item, index) => this.source[index] = item)
            this._updateIndexes()
        } finally {
            this._resetting = false
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
            index = this.count
        } else {
            if (index < 0 || index > this.count) {
                throw new Error('Out of range: index')
            }
        }
        this.source.splice(index, 0, item)
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
            item = this.source[args]
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
                const index = this.source.indexOf(item)
                this.source.splice(index, 1)
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

    getDeleteds(): T[] {
        const list = Array.from(this._allItems.keys())
        return list.filter(item => {
            const watcher = this._watchers.get(item)
            return watcher!.status === DataStatus.Deleted
        })
    }

    getModifieds(): T[] {
        const list = Array.from(this._allItems.keys())
        return list.filter(item => {
            const watcher = this._watchers.get(item)
            return watcher!.status === DataStatus.Modified
        })
    }

    getAddeds(): T[] {
        const list = Array.from(this._allItems.keys())
        return list.filter(item => {
            const watcher = this._watchers.get(item)
            return watcher!.status === DataStatus.New
        })
    }

    getOriginals(): T[] {
        const list = Array.from(this._allItems.keys())
        return list.filter(item => {
            const watcher = this._watchers.get(item)
            return watcher!.status === DataStatus.Original
        })
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
                    changes: watcher!.getChanges()
                }
            }),
            modifieds: list.filter(item => {
                const watcher = this._watchers.get(item)
                return watcher && watcher.status === DataStatus.Modified
            }).map(item => {
                const watcher = this._watchers.get(item)
                return {
                    item,
                    changes: watcher!.getChanges()
                }
            }),
            deleteds: list.filter(item => {
                const watcher = this._watchers.get(item)
                return watcher && watcher.status === DataStatus.Deleted
            }).map(item => {
                const watcher = this._watchers.get(item)
                return {
                    item,
                    changes: watcher!.getChanges()
                }
            }),
            originals: list.filter(item => {
                const watcher = this._watchers.get(item)
                return !watcher || watcher.status === DataStatus.Original
            }).map(item => {
                const watcher = this._watchers.get(item)
                return {
                    item,
                    changes: watcher!.getChanges()
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
