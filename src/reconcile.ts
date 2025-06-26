import {
  Fiber,
  FC,
  HookEffect,
  FreText,
  TAG,
  FiberHost,
  FiberFinish,
} from './type';
import { createElement } from './dom';
import { resetCursor } from './hook';
import { schedule, shouldYield } from './schedule';
import { isArr, createText, createVnode } from './h';
import { commit, removeElement } from './commit';

// 当前正在处理的 Fiber 节点
let currentFiber: Fiber = null;
// 根 Fiber 节点
let rootFiber = null;

/**
 * render 方法是入口函数，将虚拟 DOM 渲染到真实 DOM 节点上
 * @param vnode 虚拟 DOM 节点
 * @param node 目标 DOM 容器节点
 */
export const render = (vnode: Fiber, node: Node) => {
  debugger;

  // 1. 通过 recycleNode 将已有的真实 DOM 节点转为虚拟节点（vnode），用于后续的同构/水合（hydrate）
  const recycleNodeValue = recycleNode(node);

  // 2. 构造根 Fiber 节点，node 是真实 DOM 节点，props.children 是新的虚拟 DOM，kids 是旧的虚拟 DOM（用于 diff）
  rootFiber = {
    node, // 真实 DOM 节点
    props: { children: vnode }, // 新的虚拟 DOM
    kids: recycleNodeValue.props.children, // 旧的虚拟 DOM（hydrate）
  } as Fiber;
  // 3. 开始调度更新流程
  update(rootFiber);
};

/**
 * update 用于标记 fiber 为 dirty，并调度 reconcile 进行 diff 和更新
 * @param fiber 要更新的 Fiber 节点
 */
export const update = (fiber?: Fiber) => {
  if (!fiber.dirty) {
    fiber.dirty = true; // 标记为脏
    schedule(() => reconcile(fiber)); // 调度 reconcile
  }
};

/**
 * recycleNode 将真实 DOM 节点递归转为虚拟节点结构，便于后续 diff
 * 用于服务端渲染（SSR）的水合（hydration）过程
 * @param node 真实 DOM 节点
 * @returns 返回对应的虚拟节点
 */
const recycleNode = (node: Node) => {
  let vnode: any = createVnode(
    node.nodeName.toLowerCase(),
    node.nodeType === 3
      ? { nodeValue: node.nodeValue } // 文本节点
      : {
          children: Array.from(node.childNodes)
            .filter(
              (node: Node) =>
                node.nodeType !== Node.TEXT_NODE || node.nodeValue.trim() !== ''
            )
            .map(recycleNode), // 递归处理子节点
        },
    null,
    null
  );
  vnode.node = node; // 绑定真实 DOM
  return vnode;
};

/**
 * reconcile 是核心调度函数，遍历 fiber 树，捕获每个 fiber 进行处理
 * 使用时间切片技术，避免长时间阻塞主线程
 * @param fiber 要协调的 Fiber 节点
 * @returns 返回下一个要处理的 Fiber 节点或 null
 */
const reconcile = (fiber?: Fiber) => {
  while (fiber && !shouldYield()) fiber = capture(fiber); // 捕获 fiber，直到 shouldYield（时间切片）
  if (fiber) return reconcile.bind(null, fiber) as typeof reconcile; // 若未完成，返回下次继续的函数
  return null;
};

/**
 * capture 处理单个 fiber 节点，分为组件和原生节点
 * 这是 Fiber 架构的核心，负责组件的渲染和更新
 * @param fiber 要捕获的 Fiber 节点
 * @returns 返回下一个要处理的 Fiber 节点
 */
const capture = (fiber: Fiber) => {
  fiber.isComp = isFn(fiber.type); // 判断是否为函数组件
  if (fiber.isComp) {
    if (isMemo(fiber)) {
      fiber.memo = true;
      return getSibling(fiber); // 跳过未变化的 memo 组件
    } else if (fiber.memo) {
      fiber.memo = false;
    }
    // 处理函数组件（hooks）
    updateHook(fiber);
  } else {
    // 处理原生节点
    updateHost(fiber as FiberHost);
  }
  if (fiber.child) return fiber.child; // 优先遍历子节点
  const sibling = getSibling(fiber); // 没有子节点则遍历兄弟节点
  return sibling;
};

/**
 * 检查 Fiber 是否为 memo 组件且 props 未变化
 * @param fiber 要检查的 Fiber 节点
 * @returns 返回是否为 memo 且未变化
 */
export const isMemo = (fiber: Fiber) => {
  if (
    (fiber.type as FC).memo &&
    fiber.type === fiber.alternate?.type &&
    fiber.alternate?.props
  ) {
    let scu = (fiber.type as FC).shouldUpdate || shouldUpdate;
    if (!scu(fiber.props, fiber.alternate.props)) {
      return true;
    }
  }
  return false;
};

/**
 * 获取下一个兄弟节点，同时处理副作用和提交
 * @param fiber 当前 Fiber 节点
 * @returns 返回下一个要处理的 Fiber 节点
 */
const getSibling = (fiber?: Fiber) => {
  while (fiber) {
    bubble(fiber);
    if (fiber.dirty) {
      fiber.dirty = false;
      commit(fiber as FiberFinish);
      return null;
    }
    if (fiber.sibling) return fiber.sibling;
    fiber = fiber.parent;
  }
  return null;
};

/**
 * 处理 Fiber 的副作用，执行 layout 和 effect hooks
 * @param fiber 要处理副作用的 Fiber 节点
 */
const bubble = (fiber: Fiber) => {
  if (fiber.isComp) {
    if (fiber.hooks) {
      side(fiber.hooks.layout); // 同步执行 layout effects
      schedule(() => side(fiber.hooks.effect) as undefined); // 异步执行 effects
    }
  }
};

/**
 * 浅比较两个对象，检查是否有属性变化
 * @param a 旧对象
 * @param b 新对象
 * @returns 返回是否有变化
 */
const shouldUpdate = (
  a: Record<string, unknown>,
  b: Record<string, unknown>
) => {
  for (let i in a) if (!(i in b)) return true;
  for (let i in b) if (a[i] !== b[i]) return true;
};

/**
 * 为函数组件创建 DocumentFragment 包装器
 * @param fiber 函数组件 Fiber
 * @returns 返回包含注释节点的 DocumentFragment
 */
const fragment = (fiber: Fiber) => {
  const f = document.createDocumentFragment() as any;
  const c = document.createComment((fiber.type as FC).name);
  f.appendChild(c);
  return f;
};

/**
 * updateHook 处理函数组件，重置 hooks 游标，执行组件函数，生成子虚拟节点
 * @param fiber 函数组件 Fiber
 */
const updateHook = (fiber: Fiber) => {
  resetCursor(); // 重置 hooks 游标
  currentFiber = fiber;
  fiber.node = fiber.node || fragment(fiber); // fragment 用于包裹函数组件

  let children = (fiber.type as FC)(fiber.props); // 执行函数组件，得到子虚拟节点
  reconcileChidren(fiber, simpleVnode(children)); // diff 子节点
};

/**
 * updateHost 处理原生节点，创建真实 DOM，diff 子节点
 * @param fiber 宿主 Fiber 节点
 */
const updateHost = (fiber: FiberHost) => {
  if (!fiber.node) {
    if (fiber.type === 'svg') fiber.lane |= TAG.SVG;
    fiber.node = createElement(fiber); // 创建真实 DOM
  }
  reconcileChidren(fiber, fiber.props.children); // diff 子节点
};

/**
 * 简化虚拟节点，将字符串转换为文本节点
 * @param type 节点类型
 * @returns 返回处理后的节点
 */
const simpleVnode = (type: Fiber | FreText) =>
  isStr(type) ? createText(type) : type;

/**
 * reconcileChidren 对比 fiber 的旧子节点和新子节点，生成 diff actions，并建立 fiber 链表
 * @param fiber 父 Fiber 节点
 * @param children 新的子节点
 */
const reconcileChidren = (
  fiber: Fiber,
  children: Fiber | Fiber[] | null | undefined
) => {
  let aCh = fiber.kids || [], // 旧子节点
    bCh = (fiber.kids = arrayfy(children)); // 新子节点
  const actions = diff(aCh, bCh); // 生成 diff actions

  for (let i = 0, prev = null, len = bCh.length; i < len; i++) {
    const child = bCh[i];
    child.action = actions[i]; // 标记 action

    if (fiber.lane & TAG.SVG) {
      child.lane |= TAG.SVG;
    }
    child.parent = fiber; // 建立父子关系
    if (i > 0) {
      prev.sibling = child; // 建立兄弟关系
    } else {
      fiber.child = child; // 第一个子节点
    }
    prev = child;
  }
};

/**
 * 克隆 Fiber 节点的状态到新节点
 * @param a 源 Fiber 节点
 * @param b 目标 Fiber 节点
 */
function clone(a: Fiber, b: Fiber) {
  b.hooks = a.hooks;
  b.ref = a.ref;
  b.node = a.node; // 临时修复
  b.kids = a.kids;
  b.alternate = a;
}

/**
 * 将单个元素或数组统一转换为数组形式
 * @param arr 输入的元素或数组
 * @returns 返回数组形式的结果
 */
export const arrayfy = <T>(arr: T | T[] | null | undefined) =>
  !arr ? [] : isArr(arr) ? arr : [arr];

/**
 * 执行副作用 hooks
 * @param effects 副作用数组
 */
const side = (effects?: HookEffect[]) => {
  effects.forEach((e) => e[2] && e[2]()); // 执行清理函数
  effects.forEach((e) => (e[2] = e[0]())); // 执行副作用函数
  effects.length = 0; // 清空数组
};

/**
 * 虚拟 DOM diff 算法 - 双端比较算法
 * 比较新旧子节点数组，生成最小化的 DOM 操作序列
 * @param aCh 旧的子节点数组
 * @param bCh 新的子节点数组
 * @returns 操作序列数组，包含 UPDATE、INSERT、MOVE、REMOVE 等操作
 */
const diff = (aCh: Fiber[], bCh: Fiber[]) => {
  // 初始化双端指针
  let aHead = 0, // 旧数组头部指针
    bHead = 0, // 新数组头部指针
    aTail = aCh.length - 1, // 旧数组尾部指针
    bTail = bCh.length - 1, // 新数组尾部指针
    aMap = {}, // 旧数组 key 到索引的映射
    bMap = {}, // 新数组 key 到索引的映射
    // 判断两个节点是否相同（类型和 key 都相同）
    same = (a: Fiber, b: Fiber) => {
      return a.type === b.type && a.key === b.key;
    },
    temp = [], // 临时存储从尾部匹配的操作
    actions = []; // 最终的操作序列

  // 第一步：从尾部开始匹配相同的节点
  // 这样可以快速处理尾部相同的节点，减少后续比较的工作量
  while (aHead <= aTail && bHead <= bTail) {
    if (!same(aCh[aTail], bCh[bTail])) break;
    clone(aCh[aTail], bCh[bTail]); // 复制旧节点的状态到新节点
    temp.push({ op: TAG.UPDATE }); // 标记为更新操作
    aTail--; // 旧数组尾部指针前移
    bTail--; // 新数组尾部指针前移
  }

  // 第二步：从头部开始匹配相同的节点
  // 处理头部相同的节点
  while (aHead <= aTail && bHead <= bTail) {
    if (!same(aCh[aHead], bCh[bHead])) break;

    clone(aCh[aHead], bCh[bHead]); // 复制旧节点的状态到新节点
    actions.push({ op: TAG.UPDATE }); // 标记为更新操作
    aHead++; // 旧数组头部指针后移
    bHead++; // 新数组头部指针后移
  }

  // 第三步：为剩余节点建立 key 映射
  // 为旧数组中剩余节点建立 key 到索引的映射
  for (let i = aHead; i <= aTail; i++) {
    if (aCh[i].key) aMap[aCh[i].key] = i;
  }
  // 为新数组中剩余节点建立 key 到索引的映射
  for (let i = bHead; i <= bTail; i++) {
    if (bCh[i].key) bMap[bCh[i].key] = i;
  }

  // 第四步：处理剩余的未匹配节点
  // 这是算法的核心部分，处理所有未在头部和尾部匹配的节点
  while (aHead <= aTail || bHead <= bTail) {
    var aElm = aCh[aHead], // 当前旧数组头部元素
      bElm = bCh[bHead]; // 当前新数组头部元素

    // 情况1：旧数组头部元素已被标记为删除（null）
    if (aElm === null) {
      aHead++;
    }
    // 情况2：新数组已遍历完毕，旧数组剩余元素需要删除
    else if (bTail + 1 <= bHead) {
      removeElement(aElm); // 删除旧元素
      aHead++;
    }
    // 情况3：旧数组已遍历完毕，新数组剩余元素需要插入
    else if (aTail + 1 <= aHead) {
      actions.push({ op: TAG.INSERT, cur: bElm, ref: aElm });
      bHead++;
    }
    // 情况4：头部元素相同，直接更新
    else if (same(aElm, bElm)) {
      clone(aElm, bElm); // 复制状态
      actions.push({ op: TAG.UPDATE });
      aHead++;
      bHead++;
    }
    // 情况5：头部元素不同，需要查找匹配的节点
    else {
      var foundB = bMap[aElm.key]; // 在新数组中查找旧元素的 key
      var foundA = aMap[bElm.key]; // 在旧数组中查找新元素的 key

      // 情况5a：旧元素在新数组中找不到，需要删除
      if (foundB == null) {
        removeElement(aElm);
        aHead++;
      }
      // 情况5b：新元素在旧数组中找不到，需要插入
      else if (foundA == null) {
        actions.push({ op: TAG.INSERT, cur: bElm, ref: aElm });
        bHead++;
      }
      // 情况5c：找到了匹配的节点，需要移动
      else {
        clone(aCh[foundA], bElm); // 复制找到的旧节点状态
        actions.push({ op: TAG.MOVE, cur: aCh[foundA], ref: aElm });
        aCh[foundA] = null; // 标记已移动的节点为 null
        bHead++;
      }
    }
  }

  // 第五步：将尾部匹配的操作添加到操作序列末尾
  // 注意：temp 中的操作需要逆序添加，因为它们是按相反顺序收集的
  for (let i = temp.length - 1; i >= 0; i--) {
    actions.push(temp[i]);
  }

  return actions; // 返回完整的操作序列
};

/**
 * 获取当前正在处理的 Fiber 节点
 * @returns 返回当前 Fiber 节点
 */
export const useFiber = () => currentFiber || null;

/**
 * 检查值是否为函数类型
 * @param x 要检查的值
 * @returns 返回是否为函数
 */
export const isFn = (x: unknown): x is Function => typeof x === 'function';

/**
 * 检查值是否为字符串或数字类型
 * @param s 要检查的值
 * @returns 返回是否为字符串或数字
 */
export const isStr = (s: unknown): s is number | string =>
  typeof s === 'number' || typeof s === 'string';
