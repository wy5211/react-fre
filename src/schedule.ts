import { Task, TaskCallback } from './type';

// 任务队列，存放待执行的任务（如虚拟DOM diff任务）
const queue: Task[] = [];
// 每个时间切片的最大执行时长（毫秒），模拟 React 的时间分片调度
const threshold: number = 5;
// 过渡任务队列，存放需要异步执行的回调（如 setState、diff 等）
const transitions: (() => void)[] = [];
// 当前时间片的截止时间
let deadline: number = 0;

/**
 * 启动一个过渡任务（如 React 的 startTransition）
 * 将回调加入 transitions 队列并尝试调度
 * @param cb 要执行的过渡回调函数
 */
export const startTransition = (cb: () => void) => {
  // push 返回新长度，&& translate() 只在 push 后执行
  transitions.push(cb) && translate();
};

/**
 * 调度一个任务（如虚拟DOM diff）
 * 将任务加入队列并触发调度
 * @param callback 要执行的任务回调函数
 */
export const schedule = (callback: TaskCallback) => {
  queue.push({ callback });
  startTransition(flush);
};

/**
 * 生成调度函数，根据是否有待处理任务选择不同的异步调度方式
 * @param pending 是否有待处理任务的标志
 * @returns 返回对应的调度函数
 */
const task = (pending: boolean) => {
  // cb 用于执行 transitions 队列中的第一个回调
  const cb = () => transitions.splice(0, 1).forEach((c) => c());

  // 如果不是 pending，优先用 queueMicrotask（微任务，优先级高）
  if (!pending && typeof queueMicrotask !== 'undefined') {
    return () => queueMicrotask(cb);
  }

  // 否则用 MessageChannel（宏任务，优先级次之，兼容性好）
  if (typeof MessageChannel !== 'undefined') {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = cb;
    return () => port2.postMessage(null);
  }

  // 最后兜底用 setTimeout（优先级最低）
  return () => setTimeout(cb);
};

// 当前的调度函数，初始为非 pending 状态
let translate = task(false);

/**
 * 执行任务队列的主函数，模拟 React 的调度循环
 * 在时间切片内尽可能多地执行任务，超出时间则让出主线程
 */
const flush = () => {
  // 设定本次时间片的截止时间
  deadline = getTime() + threshold;
  // 取出队首任务
  let job = peek(queue);

  // 在未超时且有任务时循环执行
  while (job && !shouldYield()) {
    const { callback } = job;
    // 先将当前任务的 callback 置空，防止重复执行
    job.callback = null;
    // 执行任务，返回值为下一个任务（如 diff 过程中的递归）
    const next = callback();
    if (next) {
      // 如果有下一个任务，继续挂载到当前 job
      job.callback = next;
    } else {
      // 否则任务完成，移出队列
      queue.shift();
    }
    // 取下一个任务
    job = peek(queue);
  }

  // 如果还有任务未完成，切换为 pending 状态并递归调度（时间切片让出主线程）
  job && (translate = task(shouldYield())) && startTransition(flush);
};

/**
 * 判断是否需要让出主线程（即是否超出本时间片）
 * @returns 返回是否需要让出主线程
 */
export const shouldYield = () => {
  return getTime() >= deadline;
};

/**
 * 获取当前高精度时间（performance.now()，单位毫秒）
 * @returns 返回当前时间戳
 */
export const getTime = () => performance.now();

/**
 * 获取队首任务
 * @param queue 任务队列
 * @returns 返回队首任务
 */
const peek = (queue: Task[]) => queue[0];
