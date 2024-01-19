import internals from 'shared/internals';
import { FiberNode } from './fiber';
import { Action } from 'shared/ReactTypes';
import { Dispatch, Dispatcher } from 'react/src/currentDispatcher';
import {
	UpdateQueue,
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	processUpdateQueue
} from './updateQueue';
import { schedulerUpdateOnFiber } from './workLoop';
// 存储当前FC对应的FiberNode
let currentlyRenderingFiber: FiberNode | null = null;

//  获取当前将要执行的hook
let workInProgressHook: Hook | null = null;

let currentHook: Hook | null = null;

// 通过内部数据共享层，获不同阶段使用hooks集合
const { currentDispatcher } = internals;

// 每个hook对应一个Hook数据结构
interface Hook {
	memoizedState: any; // 存储与hook相对应的数据
	updateQueue: unknown;
	next: Hook | null;
}

export function renderWithHooks(wip: FiberNode) {
	// 保存当前正在render的FC对应的Component
	currentlyRenderingFiber = wip;

	wip.memoizedState = null;

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

	return children;
}

const HooksDispatcherOnUpdate: Dispatcher = {
	useState: updateState
};

function updateState<State>(): [State, Dispatch<State>] {
	// 获取当前useState对应的数据结构
	const hook = updateWorkInProgressHook();

	// 计算新状态，即取出update进行消费，消费update实际上就是执行action，action就是用户传入setNum中的回调函数
	// const [num, setNum] = useState(100)
	// setNum(()=> num + 1)
	const queue = hook.updateQueue as UpdateQueue<State>;
	const pending = queue.shared.pending;

	if (pending !== null) {
		const { memoizedState } = processUpdateQueue(hook.memoizedState, pending);
		hook.memoizedState = memoizedState;
	}

	return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}
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
		nextCurrentHook = currentHook.next;
	}

	if (nextCurrentHook === null) {
		// mount/update: u1 u2 u3
		// update：      u1 u2 u3 u4
		if (__DEV__) {
			console.warn(`本次${currentlyRenderingFiber?.type}的hooks比上次多`);
		}
	}

	currentHook = nextCurrentHook;
	const newHook: Hook = {
		memoizedState: currentHook?.memoizedState,
		updateQueue: currentHook?.updateQueue,
		next: null
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
// FC的mount阶段，对应的hooks集合
const HooksDispatcherOnMount: Dispatcher = {
	useState: mountState
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
	hook.memoizedState = memoizedState;
	hook.updateQueue = queue;

	// @ts-ignore
	// 使用bind的目的是，useState返回的dispatch，可以在任何地方调用，因为内部所需的数据已经为其准备好了
	const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber!, queue);
	queue.dispatch = dispatch;
	return [memoizedState, dispatch];
}

function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: UpdateQueue<State>,
	action: Action<State>
) {
	// 接入更新流程，与updateContainer逻辑类似
	const update = createUpdate(action);

	enqueueUpdate(updateQueue, update);

	schedulerUpdateOnFiber(fiber);
}

// 获取当前hook对应的数据结构;
function mountWorkInProgressHook(): Hook {
	const hook: Hook = {
		memoizedState: null, // 该hook对应数据存放在这
		updateQueue: null, // hook会触发更新，使用updateQueue将其接入更新逻辑
		next: null
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
