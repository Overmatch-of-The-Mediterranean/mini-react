import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';
import { Lane } from './fiberLanes';

export interface Update<State> {
	action: Action<State>;
	lane: Lane;
	next: Update<any> | null;
}

export interface UpdateQueue<State> {
	shared: {
		pending: Update<State> | null;
	};
	dispatch: Dispatch<State> | null;
}

// 创建更新，就像时Vue中的实例化生成effect
export const createUpdate = <State>(
	action: Action<State>,
	lane: Lane
): Update<State> => {
	return {
		action,
		lane,
		next: null
	};
};

// 作用就像Vue中收集依赖的set集合，将节点与副作用函数连接起来
export const createUpdateQueue = <State>() => {
	return {
		shared: {
			pending: null
		},
		dispatch: null
	} as UpdateQueue<State>;
};

// 收集依赖时调用的函数
export const enqueueUpdate = <Action>(
	updateQueue: UpdateQueue<Action>,
	update: Update<Action>
) => {
	const pending = updateQueue.shared.pending;

	// 构成环状链表，每次加入的update都是链表的最后一个节点
	if (pending === null) {
		update.next = update;
	} else {
		update.next = pending.next;
		pending.next = update;
	}
	// pending指向链表的最后一个节点
	updateQueue.shared.pending = update;
};

// 就像Vue中，取出副作用函数执行一样
export const processUpdateQueue = <State>(
	baseState: State,
	pendingUpdate: Update<State> | null,
	renderLane: Lane
): { memoizedState: State } => {
	const result: ReturnType<typeof processUpdateQueue<State>> = {
		memoizedState: baseState
	};

	if (pendingUpdate !== null) {
		// c -> a -> b -> c
		const first = pendingUpdate.next;
		let pending = pendingUpdate.next as Update<any>;

		do {
			const updateLane = pending?.lane;
			if (updateLane === renderLane) {
				// this.setState(state或函数)
				const action = pendingUpdate.action;
				if (action instanceof Function) {
					// baseState 1 update (x) => 4x -> memoizedState 4
					baseState = action(baseState);
				} else {
					// baseState 1 update 2 -> memoizedState 2
					baseState = action;
				}
			} else {
				if (__DEV__) {
					console.warn('不应该进入updateLane !== renderLane的逻辑');
				}
			}
			pending = pending.next as Update<any>;
		} while (pending !== first); // 循环一遍结束
	}

	result.memoizedState = baseState;
	return result;
};
