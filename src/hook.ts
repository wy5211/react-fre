// 该文件实现了类似 React 的简易 hooks 机制，包括 useState、useReducer、useEffect、useMemo、useCallback、useRef、useContext 等核心 hook。
// 通过 cursor 记录当前 hook 的调用顺序，实现 hooks 的依赖和状态管理。
// 适合学习 React hooks 的原理和简化实现。

import { update, isFn, useFiber } from './reconcile';
import {
  DependencyList,
  Reducer,
  Fiber,
  Dispatch,
  SetStateAction,
  EffectCallback,
  RefObject,
  FreNode,
  HookList,
  HookEffect,
  HookReducer,
  HookMemo,
} from './type';

// 空数组常量，用于默认依赖
const EMPTY_ARR = [];

// cursor 用于记录当前 hook 的调用顺序，实现 hooks 的依赖和状态隔离
let cursor = 0;

// 每次组件渲染前重置 cursor
export const resetCursor = () => {
  cursor = 0;
};

// useState 实现，底层其实是 useReducer 的特例
// initState: 初始状态
// 返回 [state, setState]
export const useState = <T>(initState: T) => {
  debugger;
  return useReducer<T, SetStateAction<T>>(null, initState);
};

// useReducer 实现
// reducer: 状态处理函数
// initState: 初始状态
// 返回 [state, dispatch]
export const useReducer = <S, A>(
  reducer?: Reducer<S, A>,
  initState?: S
): [S, Dispatch<A>] => {
  // 获取当前 hook 的存储槽和当前 fiber
  const [hook, current] = getSlot<HookReducer>(cursor++);
  // 初始化 hook 状态
  if (hook.length === 0) {
    hook[0] = initState;
  }
  // setState 或 dispatch 的实现
  hook[1] = (value: A | Dispatch<A>) => {
    let v = reducer
      ? reducer(hook[0], value as any)
      : isFn(value)
      ? value(hook[0])
      : value;
    // 只有状态变化时才触发更新
    if (hook[0] !== v) {
      hook[0] = v;
      update(current);
    }
  };
  return hook as Required<HookReducer>;
};

// useEffect 实现，副作用钩子，异步执行
export const useEffect = (cb: EffectCallback, deps?: DependencyList) => {
  return effectImpl(cb, deps!, 'effect');
};

// useLayout 实现，布局副作用钩子，同步执行
export const useLayout = (cb: EffectCallback, deps?: DependencyList) => {
  return effectImpl(cb, deps!, 'layout');
};

// effect 的底层实现，区分 effect 和 layout
const effectImpl = (
  cb: EffectCallback,
  deps: DependencyList,
  key: 'effect' | 'layout'
) => {
  const [hook, current] = getSlot<HookEffect>(cursor++);
  // 依赖变化时，保存新的回调和依赖，并加入 fiber 的 hooks 队列
  if (isChanged(hook[1], deps)) {
    hook[0] = cb;
    hook[1] = deps;
    current.hooks[key].push(hook as Required<HookEffect>);
  }
};

// useMemo 实现，依赖不变时缓存计算结果
export const useMemo = <S = Function>(
  cb: () => S,
  deps?: DependencyList
): S => {
  const hook = getSlot<HookMemo>(cursor++)[0];
  // 依赖变化时重新计算
  if (isChanged(hook[1], deps!)) {
    hook[1] = deps;
    return (hook[0] = cb());
  }
  return hook[0];
};

// useCallback 实现，返回稳定的回调函数
export const useCallback = <T extends (...args: any[]) => void>(
  cb: T,
  deps?: DependencyList
): T => {
  return useMemo(() => cb, deps);
};

// useRef 实现，返回一个可变的 ref 对象
export const useRef = <T>(current: T): RefObject<T> => {
  return useMemo(() => ({ current }), []);
};

// 获取当前 fiber 的第 cursor 个 hook 槽
export const getSlot = <T extends HookList = HookList>(cursor: number) => {
  const current: Fiber = useFiber();
  // hooks 挂载在 fiber 上，包含 list/effect/layout 三类
  const hooks =
    current.hooks || (current.hooks = { list: [], effect: [], layout: [] });
  // 如果当前槽不存在则初始化
  if (cursor >= hooks.list.length) {
    hooks.list.push([] as any);
  }
  // 返回当前槽和 fiber
  return [hooks.list[cursor], current] as unknown as [Partial<T>, Fiber];
};

// ContextType 类型，定义 context 组件和初始值
export type ContextType<T> = {
  ({ value, children }: { value: T; children: FreNode }): FreNode;
  initialValue: T;
};

type SubscriberCb = () => void;

// 创建 context，返回一个 context 组件
export const createContext = <T>(initialValue: T): ContextType<T> => {
  const contextComponent: ContextType<T> = ({ value, children }) => {
    // 用 ref 保存当前 value
    const valueRef = useRef(value);
    // 用 set 保存所有订阅者
    const subscribers = useMemo(() => new Set<SubscriberCb>(), EMPTY_ARR);

    // value 变化时通知所有订阅者
    if (valueRef.current !== value) {
      valueRef.current = value;
      subscribers.forEach((subscriber) => subscriber());
    }

    return children;
  };
  contextComponent.initialValue = initialValue;
  return contextComponent;
};

// useContext 实现，获取 context 的值
export const useContext = <T>(contextType: ContextType<T>) => {
  let subscribersSet: Set<Function>;

  // 触发组件更新的回调
  const triggerUpdate = useReducer(null, null)[1] as SubscriberCb;

  // 组件卸载时取消订阅
  useEffect(() => {
    return () => subscribersSet && subscribersSet.delete(triggerUpdate);
  }, EMPTY_ARR);

  // 向上查找 context fiber
  let contextFiber = useFiber().parent;
  while (contextFiber && contextFiber.type !== contextType) {
    contextFiber = contextFiber.parent;
  }

  if (contextFiber) {
    // 获取 context fiber 的 value 和 subscribers
    const hooks = contextFiber.hooks.list as unknown as [
      [RefObject<T>],
      [Set<SubscriberCb>]
    ];
    const [[value], [subscribers]] = hooks;

    // 订阅 context 更新
    subscribersSet = subscribers.add(triggerUpdate);

    return value.current;
  } else {
    // 没有找到 context，返回初始值
    return contextType.initialValue;
  }
};

// 判断依赖是否变化
export const isChanged = (a: DependencyList | undefined, b: DependencyList) => {
  return (
    !a ||
    a.length !== b.length ||
    b.some((arg, index) => !Object.is(arg, a[index]))
  );
};
