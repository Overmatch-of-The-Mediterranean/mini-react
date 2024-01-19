import { ReactElementType } from 'shared/ReactTypes';
import { FiberNode, FiberRootNode } from './fiber';
import {
	ChildrenDeletion,
	MutationMask,
	NoFlags,
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

export const commitMutationEffects = (finishedWork: FiberNode) => {
	let nextEffect: FiberNode | null = finishedWork;
	// 开始进行DFS的向下递的过程，找到这一条路径上最后一个有与Mutation阶段相关的flags的FiberNode
	while (nextEffect !== null) {
		const child: FiberNode | null = nextEffect.child;

		if (
			(nextEffect.subTreeFlags & MutationMask) !== NoFlags &&
			child !== null
		) {
			// 找到这一条路径上最后一个有与Mutation阶段相关的flags的FiberNode;
			nextEffect = child;
		} else {
			// 找到后，对FiberNode节点进行相应的DOM操作，并向上遍历 DFS
			up: while (nextEffect !== null) {
				// 开始处理FiberNode上与Mutation阶段相关的flags副作用
				commitMutationEffectsOnFiber(nextEffect);

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

export const commitMutationEffectsOnFiber = (finishedWork: FiberNode) => {
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
				commitDeletion(childToDelete);
			});
		}

		finishedWork.flags &= ~ChildrenDeletion;
	}
};

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
export const commitDeletion = (childToDelete: FiberNode) => {
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
				// TODO 解绑ref
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
            <A/><B/>
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
