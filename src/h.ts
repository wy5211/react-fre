import { isStr } from './reconcile';
import { FC, FreNode, FreText, Fiber } from './type';

/**
 * JSX 工厂函数，用于创建虚拟 DOM 节点
 * 这是 JSX 语法的核心函数，类似于 React.createElement
 * @param type 组件类型，可以是字符串（原生标签）或函数组件
 * @param props 组件属性对象
 * @param kids 子节点数组
 * @returns 返回创建的虚拟 DOM 节点
 */
export const h = (type: string | FC, props: any, ...kids: FreNode[]) => {
  // 确保 props 存在，避免空指针
  props = props || {};
  // 扁平化处理子节点，将嵌套数组展平
  kids = flat(arrayfy(props.children || kids));

  // 设置 children 属性，如果只有一个子节点则直接赋值，否则保持数组形式
  if (kids.length) props.children = kids.length === 1 ? kids[0] : kids;

  // 提取 key 和 ref 属性，这些是特殊属性需要单独处理
  const key = props.key || null;
  const ref = props.ref || null;

  // 从 props 中移除 key 和 ref，避免传递给 DOM 元素
  if (key) props.key = undefined;
  if (ref) props.ref = undefined;

  // 创建并返回虚拟节点
  return createVnode(type, props, key, ref);
};

/**
 * 数组化函数，将单个元素或数组统一转换为数组形式
 * @param arr 输入的元素或数组
 * @returns 返回数组形式的结果
 */
const arrayfy = <T>(arr: T | T[] | null | undefined) =>
  !arr ? [] : isArr(arr) ? arr : [arr];

/**
 * 有效性检查函数，过滤掉 null、undefined、true、false 等无效值
 * @param x 待检查的值
 * @returns 返回是否为有效值
 */
const some = <T>(x: T | boolean | null | undefined): x is T =>
  x != null && x !== true && x !== false;

/**
 * 扁平化函数，递归展平嵌套的节点数组
 * 同时过滤掉无效节点，将字符串转换为文本节点
 * @param arr 待扁平化的节点数组
 * @param target 目标数组，用于收集结果
 * @returns 返回扁平化后的节点数组
 */
const flat = (arr: FreNode[], target: Fiber[] = []) => {
  arr.forEach((v) => {
    // 如果是数组，递归扁平化
    isArr(v)
      ? flat(v, target)
      : // 如果是有效值，转换为 Fiber 节点并添加到目标数组
        some(v) && target.push(isStr(v) ? createText(v) : v);
  });
  return target;
};

/**
 * 创建虚拟节点对象
 * @param type 节点类型
 * @param props 节点属性
 * @param key 节点键值
 * @param ref 节点引用
 * @returns 返回虚拟节点对象
 */
export const createVnode = (type, props, key, ref) => ({
  type,
  props,
  key,
  ref,
});

/**
 * 创建文本节点
 * @param vnode 文本内容
 * @returns 返回文本类型的 Fiber 节点
 */
export const createText = (vnode: FreText) =>
  ({ type: '#text', props: { nodeValue: vnode + '' } } as Fiber);

/**
 * Fragment 组件，用于包裹多个子节点而不创建额外的 DOM 元素
 * @param props 组件属性
 * @returns 返回子节点
 */
export function Fragment(props) {
  return props.children;
}

/**
 * memo 高阶组件，用于性能优化
 * 当 props 没有变化时跳过重新渲染
 * @param fn 被包装的组件函数
 * @param compare 自定义比较函数
 * @returns 返回包装后的组件
 */
export function memo<T extends FC>(fn: T, compare?: T['shouldUpdate']) {
  fn.memo = true; // 标记为 memo 组件
  fn.shouldUpdate = compare; // 设置自定义比较函数
  return fn;
}

/**
 * 数组类型检查的简写
 */
export const isArr = Array.isArray;
