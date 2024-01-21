/* 触发多次更新，只进行一次更新流程需要满足下面三个目标
    1.实现一套优先级机制，每个更新都有自己的优先级
    2.能够合并一个宏/微任务触发的所有更新
    3.需要一套算法，决定那个优先级优先进入render阶段
*/

import { FiberRootNode } from './fiber';

export type Lane = number; // 代表update的优先级
export type Lanes = number; // 代表lane的集合

export const SyncLane = 0b0001;

export const NoLane = 0b0000;
export const NoLanes = 0b0000;

export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
	return laneA | laneB;
}

// 每次创建一个新update前掉用，获取该update的lane
export function requestUpdateLane() {
	return SyncLane;
}

// 规定优先数越低，优先级越高
export function getHignesPriorityLane(lanes: Lanes): Lane {
	return lanes & -lanes; // 相当于取二进制中最后一个1(包含1)往后的数
}

// 在commit阶段开始时，从Lanes中移除已经执行过的update对应的lane
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane;
}
