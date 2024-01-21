import { ReactElementType } from 'shared/ReactTypes';
import { FiberNode, FiberRootNode, PendingPassiveEffects } from './fiber';
import {
	ChildrenDeletion,
	Flags,
	MutationMask,
	NoFlags,
	PassiveEffect,
	PassiveMask,
	Placement,
	Update
} from './fiberFlags';
import {
	FunctionComponent,
	HostComponent,
	HostRoot,
	HostText
} from './workTags';
import {
	Container,
	Instance,
	appendChildToContainer,
	commitUpdate,
	insertChildToContainer,
	removeChild
} from 'hostConfig';
import { UpdateQueue } from './updateQueue';
import { Effect, EffectCallback, FCUpdateQueue } from './fiberHooks';
import { HookHasEffect } from './hookEffectTags';

export const commitMutationEffects = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	let nextEffect: FiberNode | null = finishedWork;
	// 开始进行DFS的向下递的过程，找到这一条路径上最后一个有与Mutation阶段相关的flags的FiberNode
	while (nextEffect !== null) {
		const child: FiberNode | null = nextEffect.child;

		if (
			(nextEffect.subTreeFlags & (MutationMask | PassiveMask)) !== NoFlags &&
			child !== null
		) {
			// 找到这一条路径上最后一个有与Mutation阶段相关的flags的FiberNode;
			nextEffect = child;
		} else {
			// 找到后，对FiberNode节点进行相应的DOM操作，并向上遍历 DFS
			up: while (nextEffect !== null) {
				// 开始处理FiberNode上与Mutation阶段相关的flags副作用
				commitMutationEffectsOnFiber(nextEffect, root);

				const sibling: FiberNode | null = nextEffect.sibling;
				// 判断该Fiber是否有兄弟节点
				if (sibling !== null) {
					// 有则中断归的过程，对兄弟节点进行完整的递和归
					nextEffect = sibling;
					break up;
				}

				// 没有兄弟节点，则向上归
				nextEffect = nextEffect.return;
			}
		}
	}
};

export const commitMutationEffectsOnFiber = (
	finishedWork: FiberNode,
	root: FiberRootNode
) => {
	const flags = finishedWork.flags;

	// 执行Placement对应的副作用，执行完后删除该标记
	if ((flags & Placement) !== NoFlags) {
		commitPlacement(finishedWork);
		finishedWork.flags &= ~Placement;
	}

	// Update
	if ((flags & Update) !== NoFlags) {
		commitUpdate(finishedWork);
		finishedWork.flags &= ~Update;
	}
	// ChildrenDeletion
	if ((flags & ChildrenDeletion) !== NoFlags) {
		const deletions = finishedWork.deletions;
		if (deletions !== null) {
			deletions.forEach((childToDelete) => {
				commitDeletion(childToDelete, root);
			});
		}

		finishedWork.flags &= ~ChildrenDeletion;
	}

	// 在更新时收集effect
	if ((flags & PassiveEffect) !== NoFlags) {
		commitPassiveEffect(finishedWork, root, 'update');
		finishedWork.flags &= ~PassiveEffect;
	}
};

// 收集useEffect中create与unmount函数, 即，将Fiber tree下每个FiberNode的useEffect对应的副作用收集到根(HostFiberNode)
function commitPassiveEffect(
	fiber: FiberNode,
	root: FiberRootNode,
	type: keyof PendingPassiveEffects
) {
	if (
		typeof fiber.type !== 'function' ||
		(type === 'update' && (fiber.flags & PassiveEffect) === NoFlags)
	) {
		// 不是FC或者收集update时的副作用却没有PassiveEffect标志，这些都是不合理的
		return;
	}
	// 获取该FiberNode对应的updateQueue
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;

	if (updateQueue !== null) {
		if (updateQueue.lastEffect === null && __DEV__) {
			console.warn('当FC存在PassiveEffect flag时，不应该不存在effect');
		}
		// 因为在pushEffect函数中，已经将FC中的effect hook函数对应的effect数据结构连成环状链表并存入updateQueue中了
		// 只需将环状链表从updateQueu中取出，并存入PendingPassiveEffects即可
		root.PendingPassiveEffects[type].push(updateQueue.lastEffect as Effect);
	}
}

// 遍历effect数据结构构成的环状链表，每遍历一个就执行一次callback
function commitHookEffectList(
	flags: Flags,
	lastEffect: Effect, // 环状链表的最后一个节点
	callback: (effect: Effect) => void // 根据不同阶段(卸载或更新)传入不同的callback，有不同的作用
) {
	let effect = lastEffect.next as Effect;

	// 将环状链表遍历一遍
	do {
		if ((effect.tag & flags) === flags) {
			callback(effect);
		}
		effect = effect.next as Effect;
	} while (effect !== lastEffect.next);
}

// 卸载时，遍历环状链表，执行对应的卸载副作用
export function commitHookEffectListUnmount(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			destroy();
		}

		// 卸载后，防止其副作用函数执行，将HookHasEffect标志删除
		effect.tag &= ~HookHasEffect;
	});
}

// 用来遍历并执行destroy函数，主要是为了在本次create函数执行前，将上次中的destroy函数执行完
export function commitHookEffectListDestroy(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const destroy = effect.destroy;
		if (typeof destroy === 'function') {
			destroy();
		}
	});
}

// 更新(挂载或更新阶段都可)时，将本次更新的create函数执行，并将本次的detroy函数保存起来，在下次更新执行create函数前执行
export function commitHookEffectListUpdate(flags: Flags, lastEffect: Effect) {
	commitHookEffectList(flags, lastEffect, (effect) => {
		const create = effect.create;
		if (typeof create === 'function') {
			// 将本次effect hook(以useEffect为例)对应create回调函数返回的destroy函数保存在本次的effect中, 为下一次更新时取出destroy使用做准备; 因为在更新阶段执行UpdateEffect时，会获取上次的effect数据结构，从中取出destroy函数
			// mountEffect时，effect.destroy为undefined; 在updateEffect时，其值为destroy。
			// 为什么这里都有了存储destroy的操作，UpdateEffect中pushEffect函数的destroy那个参数还得传，因为UpdateState中pushEffect传的destroy参数是为了在组件卸载时能立即执行destroy回调函数
			// 而下面这个存储操作主要是为了用于将destroy函数在下次更新的，create函数执行前执行
			// 可以结合视频上的demo案例理解，Child卸载时，其内部useEffect的destroy立即执行; num变化后，App中第二个useEffect的destroy先执行一次(这一次执行就是上次残留的destroy)，再执行create回调
			effect.destroy = create();
		}
	});
}

// 处理第二种Fragment删除情况，此时需要收集多个子树的根host节点
/*
    <div>
        <>
            <p>1</p>
            <p>2</p>
        </>

        <div></div>
    </div>
*/
function recordHostChildrenToDelete(
	childrenToDelete: FiberNode[],
	unmountFiber: FiberNode
) {
	const lastOne = childrenToDelete[childrenToDelete.length - 1];

	if (!lastOne) {
		// 代表这个unmountFiber是这一级中要删除的第一个节点
		childrenToDelete.push(unmountFiber);
	} else {
		// 判断是否是lastOne的sibling
		let node = lastOne.sibling;
		while (node !== null) {
			if (node === unmountFiber) {
				childrenToDelete.push(unmountFiber);
			}
			node = node.sibling;
		}
	}
}

// 1.遍历要删除的子树，找到子树根Fiber对应的hostComponent
// 2.获取rootHostComponent的父hostComponent，然后将该子树从父hostComponent中删除
export const commitDeletion = (
	childToDelete: FiberNode,
	root: FiberRootNode
) => {
	let rootChildrenToDelete: FiberNode[] = [];

	// 递归遍历子树，对每个fiber都执行该方法，看是否是根host
	commitNestedComponent(childToDelete, (unmountFiber: FiberNode) => {
		switch (unmountFiber.tag) {
			case HostComponent:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				// TODO 解绑ref
				return;
			case HostText:
				recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
				return;
			case FunctionComponent:
				// 在卸载时收集effect
				commitPassiveEffect(unmountFiber, root, 'unmount');
				return;
			default:
				if (__DEV__) {
					console.warn('未处理的unmount类型');
				}
				break;
		}
	});

	// 删除rootChildrenToDelete
	if (rootChildrenToDelete.length) {
		const hostParent = getHostParent(childToDelete);

		if (hostParent !== null) {
			rootChildrenToDelete.forEach((node) => {
				removeChild(node.stateNode, hostParent);
			});
		}
	}
	childToDelete.return = null;
	childToDelete.child = null;
};

// 遍历子树，找到要删除子树的根Fiber
export const commitNestedComponent = (
	root: FiberNode,
	onCommitUnmount: (fiber: FiberNode) => void
) => {
	let node = root;

	while (true) {
		onCommitUnmount(node);

		// 向下查找
		if (node.child !== null) {
			node.child.return = node;
			node = node.child;
			continue;
		}

		if (node === root) {
			return;
		}

		// 向上查找
		while (node.sibling === null) {
			if (node.return === null || node.return === root) {
				return;
			}
			node = node.return;
		}

		node.sibling.return = node.return;
		node = node.sibling;
	}
};

export const commitPlacement = (finishedWork: FiberNode) => {
	if (__DEV__) {
		console.warn('执行Placement操作', finishedWork);
	}
	// 先得到host类型的父级Fiber对应的真实DOM元素
	const hostParent = getHostParent(finishedWork);

	// Placement代表移动含义时，需要得到anchor
	const sibling = getHostSibling(finishedWork);

	if (hostParent !== null) {
		// 将子DOM插入到父DOM中
		insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, sibling);
	}
};

// 将子DOM以及兄弟DOM插入父DOM中
export const insertOrAppendPlacementNodeIntoContainer = (
	finishedWork: FiberNode,
	hostParent: Container,
	before?: Instance
) => {
	if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
		// 通过before来区分Placement是插入还是移动
		if (before) {
			insertChildToContainer(finishedWork.stateNode, hostParent, before);
		} else {
			appendChildToContainer(hostParent, finishedWork.stateNode);
		}

		return;
	}

	// 下面的操作相当于找到子DOM对应的host类型的Fiber，以便获取真实DOM进行插入
	const child: FiberNode | null = finishedWork.child;

	if (child !== null) {
		insertOrAppendPlacementNodeIntoContainer(child, hostParent);
		let sibling = child.sibling;

		while (sibling !== null) {
			insertOrAppendPlacementNodeIntoContainer(sibling, hostParent);
			sibling = sibling.sibling;
		}
	}
};

// 找到父Fiber对应的真实DOM元素
function getHostParent(fiber: FiberNode): Container | null {
	let parent: FiberNode | null = fiber.return;

	while (parent) {
		const parentTag = parent.tag;
		if (parentTag === HostComponent) {
			return parent.stateNode as Container;
		}

		if (parentTag === HostRoot) {
			return (parent.stateNode as FiberRootNode).container;
		}

		parent = parent.return;
	}
	if (__DEV__) {
		console.warn('没有找到host parent');
	}
	return null;
}

// 找到目标fiber的第一个兄弟Host节点
function getHostSibling(fiber: FiberNode) {
	let node: FiberNode = fiber;
	findSibling: while (true) {
		/*  这个while对应向上查找的情况
            <App/><div/>
            function App (){
                return <A />
            }
        */
		while (node.sibling === null) {
			// 当前节点的sibling找完了还是没有找到，则向上找其parent的sibling
			const parent = node.return;

			if (
				parent === null ||
				parent.tag === HostComponent ||
				parent.tag === HostRoot
			) {
				// 没有找到
				return null;
			}
			node = parent;
		}

		node.sibling.return = node.return;
		node = node.sibling;

		/*  这个while对应向下查找的情况
            <div/><B/>
            function B () {
                return <div/>
            }
        */
		while (node.tag !== HostText && node.tag !== HostComponent) {
			// 向下遍历
			if ((node.flags & Placement) !== NoFlags) {
				// 不稳定，结束本次sibling上的查找
				continue findSibling;
			}

			// 没有孩子，结束本次sibling查找，在下一个sibling上查找
			if (node.child === null) {
				continue findSibling;
			} else {
				node.child.return = node;
				node = node.child;
			}
		}

		if ((node.flags & Placement) === NoFlags) {
			return node.stateNode;
		}
	}
}
