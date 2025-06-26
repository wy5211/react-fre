import { FiberFinish, FiberHost, HTMLElementEx, Fiber, Ref, TAG } from './type';
import { updateElement } from './dom';
import { isFn } from './reconcile';

/**
 * 提交阶段的主函数，将 Fiber 树的变化应用到真实 DOM
 * 这是渲染流程的最后阶段，负责实际的 DOM 操作
 * @param fiber 要提交的 Fiber 节点
 */
export const commit = (fiber?: FiberFinish) => {
  if (!fiber) {
    return;
  }

  // 处理 ref 引用
  refer(fiber.ref, fiber.node);
  // 递归提交子节点
  commitSibling(fiber.child);

  // 获取当前节点的操作信息
  const { op, ref, cur } = fiber.action || {};

  // 获取父节点，处理注释节点的情况
  let parent = fiber?.parent?.node;
  if (parent?.nodeType === 8) {
    parent = parent.parentNode as any;
  }

  // 处理插入或移动操作
  if (op & TAG.INSERT || op & TAG.MOVE) {
    let comment = null;
    if (fiber.isComp) {
      // 组件节点需要特殊处理，保存注释节点
      //@ts-ignore
      comment = fiber?.node?.firstChild;
    }
    // 将节点插入到指定位置
    parent.insertBefore(cur.node, ref?.node);
    if (fiber.isComp) {
      fiber.node = comment;
    }
  }

  // 处理更新操作
  if (op & TAG.UPDATE) {
    const node = fiber.node;
    // 更新 DOM 元素的属性
    updateElement(
      node,
      (fiber.alternate as FiberHost).props || {},
      (fiber as FiberHost).props
    );
  }

  // 清除操作标记
  fiber.action = null;
  // 递归提交兄弟节点
  commitSibling(fiber.sibling);
};

/**
 * 递归提交兄弟节点
 * 跳过 memo 组件，避免不必要的提交
 * @param fiber 要提交的 Fiber 节点
 */
function commitSibling(fiber?: FiberFinish) {
  if (fiber?.memo) {
    // 如果是 memo 组件且未变化，跳过提交
    commitSibling(fiber.sibling);
  } else {
    // 否则正常提交
    commit(fiber);
  }
}

/**
 * 处理 ref 引用
 * 支持函数形式和对象形式的 ref
 * @param ref ref 引用
 * @param dom DOM 元素
 */
const refer = (ref?: Ref<HTMLElementEx>, dom?: HTMLElementEx) => {
  if (ref) {
    if (isFn(ref)) {
      // 函数形式的 ref
      ref(dom);
    } else {
      // 对象形式的 ref
      ref.current = dom;
    }
  }
};

/**
 * 递归处理子节点的 ref 引用
 * 在组件卸载时清理所有子节点的 ref
 * @param kids 子节点数组
 */
const kidsRefer = (kids: Fiber[]) => {
  kids?.forEach((kid) => {
    // 递归处理子节点的子节点
    kid.kids && kidsRefer(kid.kids);
    // 清理当前节点的 ref
    refer(kid.ref, null);
  });
};

/**
 * 移除 DOM 元素
 * 处理组件卸载和 DOM 元素删除
 * @param fiber 要移除的 Fiber 节点
 * @param flag 是否已经移除的标志，避免重复移除
 */
export const removeElement = (fiber: Fiber, flag: boolean = true) => {
  if (fiber.isComp) {
    // 组件节点：执行清理函数
    fiber.hooks && fiber.hooks.list.forEach((e) => e[2] && e[2]());
  } else {
    // 宿主节点：从 DOM 中移除
    if (flag) {
      (fiber.node.parentNode as any).removeChild(fiber.node);
      flag = false;
    }
    // 清理子节点的 ref
    kidsRefer(fiber.kids);
    // 清理当前节点的 ref
    refer(fiber.ref, null);
  }
  // 递归移除子节点
  fiber?.kids?.forEach((v) => removeElement(v, flag));
};
