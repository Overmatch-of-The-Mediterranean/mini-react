import { Key, Props, ReactElementType } from 'shared/ReactTypes';
import {
	FiberNode,
	createFiberFromElement,
	createFiberFromFragment,
	createWorkInProgress
} from './fiber';
import { Fragment, HostComponent, HostRoot, HostText } from './workTags';
import { ChildrenDeletion, Placement } from './fiberFlags';
import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';

export type ExistingChildren = Map<number | string, FiberNode>;

export function childReconciler(shouldTrackEffect: boolean) {
	// 删除该节点及其兄弟节点
	function deleteRemainingChildren(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode
	) {
		// shouldTrackEffect为true代表更新，shouldTrackEffect为false代表挂载
		// 只有更新才有可能进行删除操作，挂载则不需要进行删除操作
		if (!shouldTrackEffect) {
			return;
		}

		let childToDelete = currentFirstChild;
		while (childToDelete !== null) {
			deleteChild(returnFiber, childToDelete);
			childToDelete = childToDelete.sibling!;
		}
	}

	// 将要删除的FiberNode推入父Fiber的deletions，并对父Fiber打上ChildrenDeletion标记
	function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
		// shouldTrackEffect为true代表更新，shouldTrackEffect为false代表挂载
		// 只有更新才有可能进行删除操作，挂载则不需要进行删除操作
		if (!shouldTrackEffect) {
			return;
		}
		const deletions = returnFiber.deletions;
		if (deletions === null) {
			returnFiber.deletions = [childToDelete];
			returnFiber.flags |= ChildrenDeletion;
		} else {
			deletions.push(childToDelete);
		}
	}

	// 在current和wip之间复用同一个FiberNode
	function useFiber(fiber: FiberNode, pendingProps: Props): FiberNode {
		const clone = createWorkInProgress(fiber, pendingProps);
		clone.index = 0;
		clone.sibling = null;
		return clone;
	}

	function getElementKeyToUse(element: any, index?: number): Key {
		if (
			Array.isArray(element) ||
			typeof element === 'string' ||
			typeof element === 'number' ||
			element === undefined ||
			element === null
		) {
			return index;
		}
		return element.key !== null ? element.key : index;
	}

	// 这个函数其实就是，拿新children中每一项，去旧的children中查找，看是否能复用，不能复用就新建节点。
	function updateFromMap(
		returnFiber: FiberNode,
		existingChildren: ExistingChildren,
		index: number,
		element: any
	): FiberNode | null {
		const keyToUse = getElementKeyToUse(element, index);
		const before = existingChildren.get(keyToUse);

		// 新的一项element时HostText类型，看其是否能复用
		if (typeof element === 'string' || typeof element === 'number') {
			// hostText
			if (before) {
				if (before.tag === HostText) {
					existingChildren.delete(keyToUse);
					return useFiber(before, { content: element + '' });
				}
			}
			return new FiberNode(HostText, { content: element + '' }, null);
		}

		// 其他reactElement类型，对其每个具体类型进行判断，看是否能复用
		if (typeof element === 'object' && element !== null) {
			switch (element.$$typeof) {
				case REACT_ELEMENT_TYPE:
					if (element.type === REACT_FRAGMENT_TYPE) {
						return updateFragment(
							returnFiber,
							before,
							element,
							keyToUse,
							existingChildren
						);
					}
					if (before) {
						if (before.type === element.type) {
							existingChildren.delete(keyToUse);
							return useFiber(before, element.props);
						}
					}
					return createFiberFromElement(element);
			}
		}
		// 处理第三种Fragment情况
		/*
            jsx('ul', {
                children:[
                    jsx('li', {
                        children:'a'
                    }),
                    jsx('li', {
                        childrem:'b'
                    }),
                    arr
                ]
            })
        */
		// 把arr当作Fragment来处理
		if (Array.isArray(element)) {
			return updateFragment(
				returnFiber,
				before,
				element,
				keyToUse,
				existingChildren
			);
		}
		return null;
	}

	// 对新children中Fragment类型的element进行处理，看是否能复用
	function updateFragment(
		returnFiber: FiberNode,
		current: FiberNode | undefined,
		elements: any[],
		key: Key,
		existingChildren: ExistingChildren
	) {
		let fiber;
		if (!current || current.tag !== Fragment) {
			fiber = createFiberFromFragment(elements, key);
		} else {
			existingChildren.delete(key);
			fiber = useFiber(current, elements);
		}

		fiber.return = returnFiber;
		return fiber;
	}

	// 将children的element，生成对应的FiberNode
	function reconcileChildrenArray(
		returnFiber: FiberNode,
		currentFirstFiber: FiberNode | null,
		newChild: any[]
	) {
		// 记录element在current对应的index
		let lastPlacedIndex = 0;
		// 当前遍历到的element为止，最后一个newFiber
		let lastNewFiber: FiberNode | null = null;
		// 第一个newFiber
		let firstNewFiber: FiberNode | null = null;

		// 1.将currentFirstFiber所有同级的fiber都收集到map中
		const existingChildren: ExistingChildren = new Map();
		let current = currentFirstFiber;
		while (current !== null) {
			const keyToUse = current.key !== null ? current.key : current.index;
			existingChildren.set(keyToUse, current);
			current = current.sibling;
		}

		for (let i = 0; i < newChild.length; i++) {
			// 2.遍历newChild，寻找是否有能复用的fiber
			const after = newChild[i];
			const newFiber = updateFromMap(returnFiber, existingChildren, i, after);

			// xxx -> false, null
			if (newFiber === null) {
				continue;
			}

			// 3.判断是插入还是移动
			newFiber.index = i;
			newFiber.return = returnFiber;

			if (lastNewFiber === null) {
				firstNewFiber = newFiber;
				lastNewFiber = newFiber;
			} else {
				lastNewFiber.sibling = newFiber;
				lastNewFiber = lastNewFiber.sibling;
			}

			// shouldTrackEffect为true代表更新，shouldTrackEffect为false代表挂载
			// 只有更新时才需要对节点是否移动进行判断，挂载时节点直接挂载，不存在移动不移动
			if (!shouldTrackEffect) {
				continue;
			}

			const current = newFiber.alternate;
			if (current !== null) {
				const oldIndex = current.index;
				if (oldIndex < lastPlacedIndex) {
					// 移动
					newFiber.flags |= Placement;
					continue;
				} else {
					// 不移动
					lastPlacedIndex = oldIndex;
				}
			} else {
				// mount，代表更新需要新增的节点，为其打上标记
				newFiber.flags |= Placement;
			}
		}

		// 4.将existingChildren中剩余没有被复用的节点都标记删除
		existingChildren.forEach((fiber) => {
			deleteChild(returnFiber, fiber);
		});

		return firstNewFiber;
	}

	// 对单个元素的FiberNode，根据key和type决定其是复用，还是删除重建，这里的删除只是打上ChildrenDeletion标记，reconciler阶段不进行flags对应的DOM操作
	// 对第一种Fragment情况(根Fragment)的处理
	/*
        <>
            <p></p>
        </>
    */
	function reconcileSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		element: ReactElementType
	) {
		const key = element.key;
		// 根据key和type决定复用还是删除
		while (currentFiber !== null) {
			if (key === currentFiber.key) {
				// key相同
				if (element.$$typeof === REACT_ELEMENT_TYPE) {
					if (element.type === currentFiber.type) {
						// type相同
						let props = element.props;
						if (element.type === REACT_FRAGMENT_TYPE) {
							// 若是Fragment类型，对其复用时，需要剥掉外面不渲染内容的那一层，获取要渲染的内容children
							props = element.props.children;
						}
						// 复用
						const exiting = useFiber(currentFiber, props);
						exiting.return = returnFiber;
						// 单节点(更新后是单节点还是多节点)diff算法 A1B2C3 -> A1，复用A1，其余兄弟节点全删除
						deleteRemainingChildren(returnFiber, currentFiber.sibling!);
						return exiting;
					}
					// 单节点diff A1B2C3 -> A2，都不能复用，全部删除，因为同一层级节点key唯一
					deleteRemainingChildren(returnFiber, currentFiber);
					break;
				} else {
					if (__DEV__) {
						console.warn('未处理的fiber类型', element);
						break;
					}
				}
			} else {
				// 单节点diff,key不同，表示当前节点不能复用，其余节点还有可能，继续循环
				deleteChild(returnFiber, currentFiber);
				currentFiber = currentFiber.sibling;
			}
		}
		// 重建
		let fiber: FiberNode;
		if (element.type === REACT_FRAGMENT_TYPE) {
			fiber = createFiberFromFragment(element.props.children, key);
		} else {
			fiber = createFiberFromElement(element);
		}

		fiber.return = returnFiber;
		return fiber;
	}
	// 对HostText对应的FiberNode进行复用，还是删除重建
	function reconcileSingleTextNode(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		content: string | number
	) {
		while (currentFiber !== null) {
			if (currentFiber.tag === HostText) {
				// 对HostText的FiberNode的复用
				const existingFiber = useFiber(currentFiber, { content });
				existingFiber.return = returnFiber;
				// 单节点diff，所以需要把其他同级节点删除
				deleteRemainingChildren(returnFiber, currentFiber.sibling!);
				return existingFiber;
			}

			// 单节点diff，这个节点不能复用，继续遍历其同级的兄弟节点，看能否复用
			deleteChild(returnFiber, currentFiber);
			currentFiber = currentFiber.sibling;
		}
		const fiber = new FiberNode(HostText, { content }, null);
		fiber.return = returnFiber;
		return fiber;
	}

	// 决定对新生成的FiberNode是否打上Placement标签，只有是HostRootFiber时才打上Placement标签
	// 这是一种使用离屏DOM树的优化
	function placeSingleNode(fiber: FiberNode) {
		if (shouldTrackEffect && fiber.alternate === null) {
			fiber.flags |= Placement;
		}
		return fiber;
	}

	// 根据child的ReactElement的类型决定创建什么样的FiberNode
	return function reconcileChildFibers(
		returnFiber: FiberNode, // 主要在删除子FiberNode时使用
		currentFiber: FiberNode | null, // 判断是否可复用时使用
		newChild?: any
	) {
		const isUnKeyedTopLevelFragment =
			typeof newChild === 'object' &&
			newChild !== null &&
			newChild.type === REACT_FRAGMENT_TYPE &&
			newChild.key === null;

		// 就里就相当于将外面Fragment包装的一层给弄掉，Fragment包装的那一层什么都不渲染
		// 拆掉一层后，得到其要渲染的内容children，newChild是数组形式，就直接进入reconcileChildrenArray逻辑
		if (isUnKeyedTopLevelFragment) {
			newChild = newChild?.props.children;
		}

		if (typeof newChild === 'object' && newChild !== null) {
			// 对children是数组类型的处理
			if (Array.isArray(newChild)) {
				return reconcileChildrenArray(returnFiber, currentFiber, newChild);
			}

			switch (newChild.$$typeof) {
				case REACT_ELEMENT_TYPE:
					// 建立ReactElement元素节点的FiberNode
					return placeSingleNode(
						reconcileSingleElement(returnFiber, currentFiber, newChild)
					);
				default:
					if (__DEV__) {
						console.warn('未实现的reconcile类型');
					}
					break;
			}
		}

		// 建立文本类型节点的FiberNode
		if (typeof newChild === 'string' || typeof newChild === 'number') {
			return placeSingleNode(
				reconcileSingleTextNode(returnFiber, currentFiber, newChild)
			);
		}
		// 兜底情况
		if (currentFiber !== null) {
			deleteRemainingChildren(returnFiber, currentFiber);
		}

		if (__DEV__) {
			console.warn('未实现的reconcile类型');
		}
		return null;
	};
}

// shouldTrackEffect为true，代表此次beginWork是更新，使用shouldTrackEffect决定是否打Placement标记
export const reconcileChildFibers = childReconciler(true);

// shouldTrackEffect为false，代表此次beginWork是挂载
export const mountChildFibers = childReconciler(false);
