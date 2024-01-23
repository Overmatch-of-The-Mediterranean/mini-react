import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';
import { Lane, NoLane, isSubsetOfLanes } from './fiberLanes';

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
): {
	memoizedState: State;
	baseState: State;
	baseQueue: Update<State> | null;
} => {
	const result: ReturnType<typeof processUpdateQueue<State>> = {
		memoizedState: baseState,
		baseState,
		baseQueue: null
	};

	if (pendingUpdate !== null) {
		// c -> a -> b -> c
		const first = pendingUpdate.next;
		let pending = pendingUpdate.next as Update<any>;

		let newBaseState = baseState;
		let newBaseQueueFirst: Update<any> | null = null;
		let newBaseQueueLast: Update<any> | null = null;
		let newState = baseState;

		do {
			const updateLane = pending?.lane;
			if (!isSubsetOfLanes(renderLane, updateLane)) {
				// 优先级不够
				const clone = createUpdate(pendingUpdate.action, updateLane);
				if (newBaseQueueFirst === null) {
					newBaseQueueFirst = clone;
					newBaseQueueLast = clone;
					// newBaseState保存最后一个没有被跳过的update的计算结果
					newBaseState = newState;
				} else {
					// 将跳过的update连成链表存储在baseQueue中
					(newBaseQueueLast as Update<any>).next = clone;
					newBaseQueueLast = clone;
				}
			} else {
				// 优先级足够
				if (newBaseQueueLast !== null) {
					const clone = createUpdate(pendingUpdate.action, NoLane);
					newBaseQueueLast.next = clone;
					newBaseQueueLast = clone;
				}

				// this.setState(state或函数)
				const action = pendingUpdate.action;
				if (action instanceof Function) {
					// baseState 1 update (x) => 4x -> memoizedState 4
					newState = action(baseState);
				} else {
					// baseState 1 update 2 -> memoizedState 2
					newState = action;
				}
			}
			pending = pending.next as Update<any>;
		} while (pending !== first); // 循环一遍结束

		if (newBaseQueueLast == null) {
			newBaseState = newState;
		} else {
			newBaseQueueLast.next = newBaseQueueFirst;
		}
		result.memoizedState = newState;
		result.baseState = newBaseState;
		result.baseQueue = newBaseQueueLast;
	}

	return result;
};
