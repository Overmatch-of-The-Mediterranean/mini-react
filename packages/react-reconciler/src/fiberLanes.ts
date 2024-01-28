/* 触发多次更新，只进行一次更新流程需要满足下面三个目标
    1.实现一套优先级机制，每个更新都有自己的优先级
    2.能够合并一个宏/微任务触发的所有更新
    3.需要一套算法，决定那个优先级优先进入render阶段
*/

import {
	unstable_IdlePriority,
	unstable_ImmediatePriority,
	unstable_NormalPriority,
	unstable_UserBlockingPriority,
	unstable_getCurrentPriorityLevel
} from 'scheduler';
import { FiberRootNode } from './fiber';
import currentBatchConfig from 'react/src/currentBatchConfig';

export type Lane = number; // 代表update的优先级
export type Lanes = number; // 代表lane的集合

export const SyncLane = 0b00001;
export const InputContinuousLane = 0b00010;
export const DefaultLane = 0b00100;
export const TransitionLane = 0b01000;
export const IdleLane = 0b10000;

export const NoLane = 0b0000;
export const NoLanes = 0b0000;

export function isSubsetOfLanes(set: Lanes, subset: Lane) {
	return (set & subset) === subset;
}

export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
	return laneA | laneB;
}

// 每次创建一个新update前掉用，获取该update的lane
export function requestUpdateLane() {
	const isTransition = currentBatchConfig.transition !== null;

	if (isTransition) {
		return TransitionLane;
	}
	const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
	const lane = schedulerPriorityToLane(currentSchedulerPriority);
	return lane;
}

// 规定优先数越低，优先级越高
export function getHignesPriorityLane(lanes: Lanes): Lane {
	return lanes & -lanes; // 相当于取二进制中最后一个1(包含1)往后的数
}

// 在commit阶段开始时，从Lanes中移除已经执行过的update对应的lane
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane;

	root.suspendedLanes = NoLanes;
	root.pingdLanes = NoLanes;
}

export function lanesToSchedulerPriority(lanes: Lanes) {
	const lane = getHignesPriorityLane(lanes);

	if (lane === SyncLane) {
		return unstable_ImmediatePriority;
	}

	if (lane === InputContinuousLane) {
		return unstable_UserBlockingPriority;
	}

	if (lane === DefaultLane) {
		return unstable_NormalPriority;
	}
	return unstable_IdlePriority;
}

export function schedulerPriorityToLane(priority: number): Lane {
	if (priority === unstable_ImmediatePriority) {
		return SyncLane;
	}

	if (priority === unstable_UserBlockingPriority) {
		return InputContinuousLane;
	}

	if (priority === unstable_NormalPriority) {
		return DefaultLane;
	}

	return NoLane;
}

// 将Suspended标记从总的标记中区分出来
export function markRootSuspended(root: FiberRootNode, suspendedLane: Lane) {
	root.suspendedLanes |= suspendedLane;
	root.pendingLanes &= ~suspendedLane;
}

// 将pingdLane标记从总的标记中区分出来
export function markRootpinged(root: FiberRootNode, pingdLane: Lane) {
	root.pingdLanes |= root.suspendedLanes & pingdLane;
}

export function getNextLane(root: FiberRootNode): Lane {
	const pendingLanes = root.pendingLanes;

	if (pendingLanes === NoLane) {
		return NoLane;
	}

	let nextLane = NoLane;
	// 排除掉挂起的lane
	const suspendedLanes = pendingLanes & ~root.suspendedLanes;
	if (suspendedLanes !== NoLanes) {
		nextLane = getHignesPriorityLane(suspendedLanes);
	} else {
		const pingdLanes = pendingLanes & root.pingdLanes;
		if (pingdLanes !== NoLanes) {
			nextLane = getHignesPriorityLane(pingdLanes);
		}
	}
	return nextLane;
}
