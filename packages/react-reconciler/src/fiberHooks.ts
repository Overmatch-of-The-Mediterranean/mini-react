import internals from 'shared/internals';
import { FiberNode } from './fiber';
import { Action } from 'shared/ReactTypes';
import { Dispatch, Dispatcher } from 'react/src/currentDispatcher';
import currentBatchConfig from 'react/src/currentBatchConfig';
import {
	Update,
	UpdateQueue,
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	processUpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';
import { Lane, NoLane, requestUpdateLane } from './fiberLanes';
import { Flags, PassiveEffect } from './fiberFlags';
import { HookHasEffect, Passive } from './hookEffectTags';
// 存储当前FC对应的FiberNode
let currentlyRenderingFiber: FiberNode | null = null;

//  获取当前将要执行的hook
let workInProgressHook: Hook | null = null;

// 当前正在执行的hook函数对应的hook数据结构
let currentHook: Hook | null = null;

let renderLane = NoLane;

// 通过内部数据共享层，获不同阶段使用hooks集合
const { currentDispatcher } = internals;

// 每个hook对应一个Hook数据结构
interface Hook {
	memoizedState: any; // 存储与hook相对应的数据，对于useState存储的就是其需要的数据,对于useEffect存储的就是其对应的effect数据结构，对于useEffect而言，其内部也存在一条链表(由effect数据结构组成)，通过其hook中的memoizedState(effect)中的next连接起来
	updateQueue: unknown;
	next: Hook | null;
	baseState: any;
	baseQueue: Update<any> | null;
}

// useEffect是在当前依赖变化后的当前commit阶段完成以后，异步执行，
// useLayoutEffect和useInsertionEffect（执行时拿不到DOM的引用，主要给css in js这种第三方库使用的）都在当前的commit阶段同步执行。
// 实现一套effect数据结构使得上面三种effect函数可以通用
export interface Effect {
	tag: Flags; // 表示当前是那个hook对应effect
	create: EffectCallback | void; // 传入的回调函数，如useEffect(()=>{})
	destroy: EffectCallback | void; // 卸载时调用的函数，如useEffect(()=> { return ()=>{} })
	deps: EffectDeps; // hook函数的第二个参数，即依赖项，如，useEffect(()=>{}, [xxx,yyy])
	next: Effect | null; // 指向下一个hook函数的effect数据结构
}

export type EffectCallback = () => void;

export type EffectDeps = any[] | null;

// 函数组件的UpdateQueue增加一个属性，lastEffect，用来存储effect数据结构组成的环形链表的最后一个effect节点
export interface FCUpdateQueue<State> extends UpdateQueue<State> {
	lastEffect: Effect | null;
}

export function renderWithHooks(wip: FiberNode, lane: Lane) {
	// 保存当前正在render的FC对应的Component
	currentlyRenderingFiber = wip;
	renderLane = lane;
	// 重置现有的State。类组件保存state信息，函数组件保存hooks信息
	wip.memoizedState = null;

	// 重置FC的存储effect的链表，因为该链表存储在updateQueue上，所以只需updateQueue重置，链表就会重置
	wip.updateQueue = null;

	const current = wip.alternate;

	// 以curent来区分FC处于mount阶段还是update阶段
	if (current !== null) {
		// update
		currentDispatcher.current = HooksDispatcherOnUpdate;
	} else {
		// mount
		currentDispatcher.current = HooksDispatcherOnMount;
	}

	// 对于FC，type就是其函数本身
	const component = wip.type;
	const props = wip.pendingProps;
	// 调用FC，其返回值就是children
	const children = component(props);

	currentlyRenderingFiber = null;
	workInProgressHook = null;
	currentHook = null;
	renderLane = NoLane;
	return children;
}

// FC的mount阶段，对应的hooks集合
const HooksDispatcherOnMount: Dispatcher = {
	useState: mountState,
	useEffect: mountEffect,
	useTransition: mountTransition
};

const HooksDispatcherOnUpdate: Dispatcher = {
	useState: updateState,
	useEffect: updateEffect,
	useTransition: updateTransition
};

// mount阶段真正的useState实现
function mountState<State>(
	initialState: State | (() => State)
): [State, Dispatch<State>] {
	// 获取当前useState对应的数据结构
	const hook = mountWorkInProgressHook();

	let memoizedState;
	if (initialState instanceof Function) {
		memoizedState = initialState();
	} else {
		memoizedState = initialState;
	}

	// 因为useState可以触发更新，将其对接入更新流程
	const queue = createUpdateQueue<State>();
	hook.baseState = memoizedState;
	hook.memoizedState = memoizedState;
	hook.updateQueue = queue;

	// @ts-ignore
	// 使用bind的目的是，useState返回的dispatch，可以在任何地方调用，因为内部所需的数据已经为其准备好了
	const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber!, queue);
	queue.dispatch = dispatch;
	return [memoizedState, dispatch];
}

function updateState<State>(): [State, Dispatch<State>] {
	// 获取当前useState对应的数据结构
	const hook = updateWorkInProgressHook();

	// 计算新状态，即取出update进行消费，消费update实际上就是执行action，action就是用户传入setNum中的回调函数
	// const [num, setNum] = useState(100)
	// setNum(()=> num + 1)
	const queue = hook.updateQueue as UpdateQueue<State>;
	const baseState = hook.baseState;
	const pending = queue.shared.pending;

	const current = currentHook as Hook;
	let baseQueue = current.baseQueue;

	if (pending !== null) {
		// pendingQueue和baseQueue保存在current中
		if (baseQueue !== null) {
			const baseFirst = baseQueue.next;
			const pendingFirst = pending.next;

			baseQueue.next = pendingFirst;
			pending.next = baseFirst;
		}

		baseQueue = pending;
		current.baseQueue = baseQueue;
		// 将链表重置，防止上次更新的update残留
		queue.shared.pending = null;
	}
	if (baseQueue !== null) {
		const {
			memoizedState,
			baseQueue: newBaseQueue,
			baseState: newBaseState
		} = processUpdateQueue(baseState, baseQueue, renderLane);

		hook.memoizedState = memoizedState;
		hook.baseQueue = newBaseQueue;
		hook.baseState = newBaseState;
	}

	return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}

// 挂载阶段执行的useEffect
function mountEffect<State>(
	create: EffectCallback | void,
	deps: EffectDeps | void
) {
	// console.log('mount deps', deps, create);
	const hook = mountWorkInProgressHook();
	const nextDeps = deps === undefined ? null : deps;

	// 打上标志，代表此次挂载FC的该useEffect有副作用需要执行
	(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
	// 创建该useEffect对应的effect结构，并打上Passive | HookHasEffect，Passive代表useEffect对应的effect，HookHasEffect代表该effect的create副作用需要执行
	hook.memoizedState = pushEffect(
		Passive | HookHasEffect,
		create,
		undefined,
		nextDeps
	);
}

function updateEffect<State>(
	create: EffectCallback | void,
	deps: EffectDeps | void
) {
	// 获取当前正在执行的hook函数对应的hook结构
	const hook = updateWorkInProgressHook();
	// console.log('deps', deps);
	// 获取新的依赖
	const nextDeps = deps === undefined ? null : deps;
	let destroy: EffectCallback | void;

	if (currentHook !== null) {
		// 获取该useEffect上次更新的effect数据结构
		const prevEffect = currentHook.memoizedState as Effect;
		// 将上次的destroy存储起来
		destroy = prevEffect.destroy;

		// 比较依赖是否发生变化
		if (nextDeps !== null) {
			//浅比较依赖
			const prevDeps = prevEffect.deps;
			if (areHookInputsEqual(nextDeps, prevDeps)) {
				hook.memoizedState = pushEffect(Passive, create, destroy, nextDeps);
				return;
			}
		}

		// 发生变化，则该useEffect对应的副作用函数需要执行，因此给当前FC的FiberNode打上PassiveEffect标识，代表FC本次更新由副作用需要执行
		(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
		// 将该FC中的这个useEffect对应的新的effect数据结构保存起来
		hook.memoizedState = pushEffect(
			Passive | HookHasEffect,
			create,
			destroy,
			nextDeps
		);
	}
}

function mountTransition(): [boolean, (callback: () => void) => void] {
	const [isPending, setPending] = mountState(false);
	const hook = mountWorkInProgressHook();

	const start = startTransition.bind(null, setPending);
	hook.memoizedState = start;

	return [isPending, start];
}

function updateTransition(): [boolean, (callback: () => void) => void] {
	const [isPending] = updateState<boolean>();
	const hook = updateWorkInProgressHook();

	const start = hook.memoizedState;

	return [isPending, start];
}

function startTransition(setPending: Dispatch<boolean>, callback: () => void) {
	setPending(true);

	// 改变优先级
	const prevTransition = currentBatchConfig.transition;
	currentBatchConfig.transition = 1;

	callback();
	setPending(false);

	// 恢复优先级
	currentBatchConfig.transition = prevTransition;
}

// 比较effect hook函数的依赖项是否发生变化
function areHookInputsEqual(nextDeps: EffectDeps, prevDeps: EffectDeps) {
	if (prevDeps === null || nextDeps === null) {
		// 对应依赖项是空数组，如，useEffect(()=>{}, [])，回调函数只在元素挂载的时候执行一次，此刻就是componentWillMount生命周期函数的功能了
		return false;
	}

	for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
		if (Object.is(prevDeps[i], nextDeps[i])) {
			continue;
		}
		return false;
	}

	return true;
}

// 用于更新阶段，获取当前hook函数对应的hook数据结构
function updateWorkInProgressHook(): Hook {
	let nextCurrentHook: Hook | null = null;

	if (currentHook === null) {
		const current = currentlyRenderingFiber?.alternate;
		if (current !== null) {
			// 更新阶段第一个hook
			nextCurrentHook = current?.memoizedState;
		} else {
			// mount
			nextCurrentHook = null;
		}
	} else {
		// 更新阶段的，后面hook函数对应的hook数据结构
		nextCurrentHook = currentHook.next;
	}

	// 用来检查是否有更新前后hook函数数量不一致的问题
	if (nextCurrentHook === null) {
		// mount/update: u1 u2 u3
		// update：      u1 u2 u3 u4
		if (__DEV__) {
			console.warn(`本次${currentlyRenderingFiber?.type}的hooks比上次多`);
		}
	}

	currentHook = nextCurrentHook as Hook;
	const newHook: Hook = {
		memoizedState: currentHook.memoizedState,
		updateQueue: currentHook.updateQueue,
		next: null,
		baseState: currentHook.baseState,
		baseQueue: currentHook.baseQueue
	};

	if (workInProgressHook === null) {
		// mount时 第一个hook
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = newHook;
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// mount时 后续的hook
		workInProgressHook.next = newHook;
		workInProgressHook = newHook;
	}
	return workInProgressHook!;
}

// 用来创建每个effect hook函数对应effect数据结构，将effect数据结构之间连接成环状链表
function pushEffect(
	hookFlags: Flags,
	create: EffectCallback | void,
	destroy: EffectCallback | void,
	deps: EffectDeps
) {
	const effect: Effect = {
		tag: hookFlags,
		create,
		destroy,
		deps,
		next: null
	};

	// 获取当前FC对应的FiberNode
	const fiber = currentlyRenderingFiber as FiberNode;
	// 获取其对应的updateQueue
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
	if (updateQueue === null) {
		// updateQueue为空，代表该FC还没有effect数据结构组成的链表
		// 创建FC的updateQueue
		const updateQueue = createFCUpdateQueue();
		fiber.updateQueue = updateQueue;
		// 构建环状链表
		effect.next = effect;
		// 将其保存在updateQueue上
		updateQueue.lastEffect = effect;
	} else {
		// updateQueue存在
		const lastEffect = updateQueue.lastEffect;
		if (lastEffect === null) {
			// updateQueue存在，但该FC还没有effect数据结构组成的链表，开始构建该链表
			effect.next = effect;
			updateQueue.lastEffect = effect;
		} else {
			// // updateQueue存在，该FC已经有effect数据结构组成的链表，将新创建的effect加入该环状链表的表尾
			const firstEffect = lastEffect.next;
			lastEffect.next = effect;
			effect.next = firstEffect;
			updateQueue.lastEffect = effect;
		}
	}

	return effect;
}

// 创建FC对应的UpdateQueue
function createFCUpdateQueue<State>() {
	const updateQueue = createUpdateQueue<State>() as FCUpdateQueue<State>;

	updateQueue.lastEffect = null;

	return updateQueue;
}

function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: UpdateQueue<State>,
	action: Action<State>
) {
	// 接入更新流程，与updateContainer逻辑类似
	const lane = requestUpdateLane();
	const update = createUpdate(action, lane);

	enqueueUpdate(updateQueue, update);

	scheduleUpdateOnFiber(fiber, lane);
}

// 获取当前hook对应的数据结构;
function mountWorkInProgressHook(): Hook {
	const hook: Hook = {
		memoizedState: null, // 该hook对应数据存放在这
		updateQueue: null, // hook会触发更新，使用updateQueue将其接入更新逻辑
		next: null,
		baseState: null,
		baseQueue: null
	};

	if (workInProgressHook === null) {
		// mount时 第一个hook
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = hook;
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// mount时 后续的hook
		workInProgressHook.next = hook;
		workInProgressHook = hook;
	}
	return workInProgressHook!;
}
