# easy-data

数据变更自动追踪工具，自动分离增、删、改，用于做数据库提交事务

## 使用方法


### 追踪属性变更

```js
const $ = require('easy-data')
const item = $({
    a: 'old-a',
    b: 'old-b'
})

console.log(item.status) // 'original'

item.a = 'new-a'
item.b = 'new-b'
item.c = 'add-c'

console.log(item.status) // 'modified'
console.log(item.$changeds())
// [
//    { property: 'a', oldValue: 'old-a', newValue: 'new-a'},
//    { property: 'b', oldValue: 'old-b', newValue: 'new-b'},
//    { property: 'c', newValue: 'add-c'}
// ]

item.$apply()

console.log(item.status) // 'original'
console.log(item.$changeds()) // []

```

### 对象状态

**$status:**

- original - 原始状态
- new - 新增状态
- modified - 已修改状态
- deleted - 已删除状态
- invalid - 无效状态

#### 原始状态 - original

未变化的状态

#### 新建状态 - new

- 在新建状态下，不会追踪属性变更
- 撤销后，变为无效状态`invalid`

```js
const $ = require('easy-data')
// 当不传递参数时，创建的对象为新建状态
const item = $()
console.log(item.status) // 'new'

item.a = 'add-a'
item.b = 'add-b'
item.c = 'add-c'

// 在新建状态下，不会追踪属性变更
console.log(item.$changeds()) // []

item.$apply()

console.log(item.status) // 'original'

```

#### 修改状态 - modified

- $apply，变为`original`
- $reset，变更为`original`并丢失修改内容，恢复修改前数据
- $delete，丢失修改内容，恢复修改前数据，并变更 为`deleted`

#### 删除状态 - deleted

- 删除状态下不允许修改
- $reset，将恢复为原始状态`original`，并丢失数据变更
- $apply，提交后将变为无效状态`invalid`

```js
const $ = require('easy-data')
// 当不传递参数时，创建的对象为新建状态
const item = $({
    a: 'prop-a',
    b: 'prop-b'
})
console.log(item.status) // 'original'

item.a = 'new-prop-a'

console.log(item.status) // 'modified'

// 当调用删除时，会自动调用reset重置对象
item.$delete()

console.log(item) // { a: 'prop-a', b: 'prop-b' }
console.log(item.status) // 'deleted'

// 在删除状态下修改属性中，将获取得一个错误： 不允许修改已删除的对象
console.log(item.$changeds()) // []

item.$apply()

// 应用变更后，对象将变成无效状态
console.log(item.status) // 'invalid'

```
