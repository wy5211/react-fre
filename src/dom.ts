import { FiberHost, HTMLElementEx, PropsOf, TAG } from './type';
import { isStr } from './reconcile';

// 默认空对象常量，用于属性比较时的默认值
const defaultObj = {} as const;

/**
 * 联合迭代器，同时遍历两个属性对象
 * 用于比较新旧属性，确保所有属性都被处理
 * @param aProps 旧属性对象
 * @param bProps 新属性对象
 * @param callback 回调函数，接收属性名、旧值、新值
 */
const jointIter = <P extends PropsOf<string>>(
  aProps: P,
  bProps: P,
  callback: (name: string, a: any, b: any) => void
) => {
  // 确保属性对象存在，避免空指针
  aProps = aProps || (defaultObj as P);
  bProps = bProps || (defaultObj as P);
  // 遍历旧属性的所有键
  Object.keys(aProps).forEach((k) => callback(k, aProps[k], bProps[k]));
  // 遍历新属性的所有键，只处理旧属性中不存在的键
  Object.keys(bProps).forEach(
    (k) => !aProps.hasOwnProperty(k) && callback(k, undefined, bProps[k])
  );
};

/**
 * 更新 DOM 元素的属性
 * 比较新旧属性，只更新发生变化的属性
 * @param dom 目标 DOM 元素
 * @param aProps 旧属性对象
 * @param bProps 新属性对象
 */
export const updateElement = (
  dom: HTMLElementEx,
  aProps: PropsOf<string>,
  bProps: PropsOf<string>
) => {
  jointIter(aProps, bProps, (name, a, b) => {
    // 如果属性值相同或者是 children 属性，跳过处理
    if (a === b || name === 'children') {
    }
    // 处理 style 属性，支持对象形式的样式
    else if (name === 'style' && !isStr(b)) {
      jointIter(a, b, (styleKey, aStyle, bStyle) => {
        if (aStyle !== bStyle) {
          dom[name][styleKey] = bStyle || '';
        }
      });
    }
    // 处理事件监听器（以 'on' 开头的属性）
    else if (name[0] === 'o' && name[1] === 'n') {
      name = name.slice(2).toLowerCase(); // 移除 'on' 前缀并转为小写
      if (a) dom.removeEventListener(name, a); // 移除旧的事件监听器
      dom.addEventListener(name, b); // 添加新的事件监听器
    }
    // 处理 DOM 元素的直接属性（如 value、checked 等）
    else if (name in dom && !(dom instanceof SVGElement)) {
      dom[name] = b || '';
    }
    // 处理 HTML 属性，如果值为 null 或 false 则移除属性
    else if (b == null || b === false) {
      // @ts-expect-error Property 'removeAttribute' does not exist on type 'Text'.
      dom.removeAttribute(name);
    }
    // 设置 HTML 属性
    else {
      // @ts-expect-error Property 'setAttribute' does not exist on type 'Text'.
      dom.setAttribute && dom?.setAttribute(name, b);
    }
  });
};

/**
 * 根据 Fiber 节点创建对应的 DOM 元素
 * @param fiber 宿主 Fiber 节点
 * @returns 返回创建的 DOM 元素
 */
export const createElement = (fiber: FiberHost) => {
  let dom: HTMLElementEx;

  // 根据节点类型创建不同的 DOM 元素
  if (fiber.type === '#text') {
    // 创建文本节点
    dom = document.createTextNode('');
  } else if (fiber.lane & TAG.SVG) {
    // 创建 SVG 元素，需要指定命名空间
    dom = document.createElementNS('http://www.w3.org/2000/svg', fiber.type);
  } else {
    // 创建普通 HTML 元素
    dom = document.createElement(fiber.type);
  }

  // 应用属性到 DOM 元素
  updateElement(dom, {}, fiber.props);
  return dom;
};
