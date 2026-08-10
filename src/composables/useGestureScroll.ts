import { onMounted, onUnmounted, ref, type Ref } from 'vue';

export interface GestureScrollOptions {
  /** 确认进入拖动前需要移动的距离。 */
  threshold?: number;
  /** 用于计算释放速度的最大指针样本数。 */
  sampleSize?: number;
  /** 不应触发内容拖动的元素选择器。 */
  ignoreSelector?: string;
}

export interface GestureScrollHandlers {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerEnd: (event: PointerEvent) => void;
  onPointerCancel: (event: PointerEvent) => void;
}

interface PointerSample {
  y: number;
  time: number;
}

const DEFAULT_IGNORE_SELECTOR = 'button, input, select, .topbar, .panel';
const DECELERATION_RATE = 0.998;
const PROJECTION_FACTOR = DECELERATION_RATE / (1000 * (1 - DECELERATION_RATE));
const SPRING_RESPONSE = 0.3;
const NORMAL_DAMPING_RATIO = 1;
const MOMENTUM_DAMPING_RATIO = 0.8;
const MOMENTUM_THRESHOLD = 120;
const MAX_FRAME_DELTA = 0.032;
const REST_POSITION_EPSILON = 0.5;
const REST_VELOCITY_EPSILON = 5;

/**
 * 为滚动容器提供可中断的拖拽滚动、释放惯性与边界阻力。
 * 拖动阶段保持 1:1 跟手，动画阶段只更新 scrollTop 与内容包装层。
 */
export function useGestureScroll(
  scrollContainer: Ref<HTMLElement | null>,
  scrollContent: Ref<HTMLElement | null>,
  options: GestureScrollOptions = {},
): GestureScrollHandlers & { isDragging: Ref<boolean> } {
  const isDragging = ref(false);
  const threshold = options.threshold ?? 10;
  const sampleSize = options.sampleSize ?? 8;
  const ignoreSelector = options.ignoreSelector ?? DEFAULT_IGNORE_SELECTOR;
  const velocitySamples: PointerSample[] = [];

  let activePointerId: number | null = null;
  let dragStartY = 0;
  let scrollStartPosition = 0;
  let scrollPosition = 0;
  let animationFrame: number | null = null;
  let prefersReducedMotion = false;
  let motionQuery: MediaQueryList | null = null;

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function getMaxScrollTop() {
    const container = scrollContainer.value;
    if (!container) return 0;
    return Math.max(0, container.scrollHeight - container.clientHeight);
  }

  function getScrollBounds() {
    const maxScrollTop = getMaxScrollTop();
    return { min: 0, max: maxScrollTop };
  }

  function rubberband(overshoot: number, dimension: number, constant = 0.55) {
    const safeDimension = Math.max(1, dimension);
    return (overshoot * safeDimension * constant) / (safeDimension + constant * overshoot);
  }

  function renderPosition(position: number) {
    const container = scrollContainer.value;
    if (!container) return;

    const { max } = getScrollBounds();
    const clampedPosition = clamp(position, 0, max);
    container.scrollTop = clampedPosition;

    const content = scrollContent.value;
    if (!content || prefersReducedMotion) {
      if (content) content.style.transform = '';
      return;
    }

    const viewport = container.clientHeight;
    let offset = 0;
    if (position < 0) {
      offset = rubberband(-position, viewport);
    } else if (position > max) {
      offset = -rubberband(position - max, viewport);
    }

    content.style.transform = offset === 0 ? '' : `translateY(${offset}px)`;
  }

  function cancelAnimation() {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  }

  function clearPointerState() {
    activePointerId = null;
    velocitySamples.length = 0;
    isDragging.value = false;
  }

  function trackVelocity(event: PointerEvent) {
    velocitySamples.push({ y: event.clientY, time: performance.now() });
    if (velocitySamples.length > sampleSize) velocitySamples.shift();
  }

  function getScrollVelocity() {
    if (velocitySamples.length < 2) return 0;

    const first = velocitySamples[0];
    const last = velocitySamples[velocitySamples.length - 1];
    const duration = last.time - first.time;
    if (duration < 1) return 0;

    // 指针向上移动时 scrollTop 增大，因此滚动速度与指针速度方向相反。
    return -((last.y - first.y) / duration) * 1000;
  }

  function releasePointerCapture(event: PointerEvent) {
    const currentTarget = event.currentTarget;
    if (!(currentTarget instanceof HTMLElement)) return;
    if (currentTarget.hasPointerCapture(event.pointerId)) {
      currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function startSpring(targetPosition: number, initialVelocity: number) {
    cancelAnimation();

    const dampingRatio =
      Math.abs(initialVelocity) >= MOMENTUM_THRESHOLD
        ? MOMENTUM_DAMPING_RATIO
        : NORMAL_DAMPING_RATIO;
    const angularFrequency = (2 * Math.PI) / SPRING_RESPONSE;
    const stiffness = angularFrequency * angularFrequency;
    const damping = 2 * dampingRatio * angularFrequency;
    let velocity = initialVelocity;
    let previousTime = 0;

    const step = (time: number) => {
      const { max } = getScrollBounds();
      const target = clamp(targetPosition, 0, max);
      const deltaTime = previousTime ? Math.min((time - previousTime) / 1000, MAX_FRAME_DELTA) : 0;
      previousTime = time;

      const acceleration = (target - scrollPosition) * stiffness - velocity * damping;
      velocity += acceleration * deltaTime;
      scrollPosition += velocity * deltaTime;
      renderPosition(scrollPosition);

      if (
        Math.abs(target - scrollPosition) <= REST_POSITION_EPSILON &&
        Math.abs(velocity) <= REST_VELOCITY_EPSILON
      ) {
        scrollPosition = target;
        renderPosition(target);
        animationFrame = null;
        return;
      }

      animationFrame = requestAnimationFrame(step);
    };

    animationFrame = requestAnimationFrame(step);
  }

  function finishPointer(event: PointerEvent, allowInertia: boolean) {
    if (event.pointerId !== activePointerId) return;

    const wasDragging = isDragging.value;
    const releaseVelocity = getScrollVelocity();
    releasePointerCapture(event);
    clearPointerState();

    if (!wasDragging) return;

    const { max } = getScrollBounds();
    if (prefersReducedMotion || !allowInertia) {
      scrollPosition = clamp(scrollPosition, 0, max);
      renderPosition(scrollPosition);
      return;
    }

    const projectedPosition = scrollPosition + releaseVelocity * PROJECTION_FACTOR;
    startSpring(clamp(projectedPosition, 0, max), releaseVelocity);
  }

  function onPointerDown(event: PointerEvent) {
    const target = event.target as Element | null;
    if (target?.closest(ignoreSelector)) return;

    const isPrimaryPointer = event.pointerType === 'mouse' ? event.button === 0 : event.isPrimary;
    if (!isPrimaryPointer || activePointerId !== null) return;

    const currentTarget = event.currentTarget;
    if (!(currentTarget instanceof HTMLElement)) return;

    const wasAnimating = animationFrame !== null;
    cancelAnimation();
    scrollPosition = wasAnimating
      ? scrollPosition
      : (scrollContainer.value?.scrollTop ?? scrollPosition);
    renderPosition(scrollPosition);

    activePointerId = event.pointerId;
    dragStartY = event.clientY;
    scrollStartPosition = scrollPosition;
    velocitySamples.length = 0;
    trackVelocity(event);
    currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent) {
    if (event.pointerId !== activePointerId) return;

    trackVelocity(event);
    const distance = Math.abs(event.clientY - dragStartY);
    if (!isDragging.value) {
      if (distance < threshold) return;
      isDragging.value = true;
    }

    event.preventDefault();
    scrollPosition = scrollStartPosition + dragStartY - event.clientY;
    renderPosition(scrollPosition);
  }

  function onPointerEnd(event: PointerEvent) {
    finishPointer(event, true);
  }

  function onPointerCancel(event: PointerEvent) {
    finishPointer(event, false);
  }

  function updateReducedMotion(matches: boolean) {
    prefersReducedMotion = matches;
    if (!matches) return;

    cancelAnimation();
    scrollPosition = clamp(
      scrollContainer.value?.scrollTop ?? scrollPosition,
      0,
      getMaxScrollTop(),
    );
    renderPosition(scrollPosition);
  }

  function handleMotionPreferenceChange(event: MediaQueryListEvent) {
    updateReducedMotion(event.matches);
  }

  if (typeof window !== 'undefined') {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion = motionQuery.matches;
  }

  onMounted(() => {
    if (!motionQuery) return;
    motionQuery.addEventListener('change', handleMotionPreferenceChange);
  });

  onUnmounted(() => {
    cancelAnimation();
    if (motionQuery) motionQuery.removeEventListener('change', handleMotionPreferenceChange);
    if (scrollContent.value) scrollContent.value.style.transform = '';
    clearPointerState();
  });

  return {
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerEnd,
    onPointerCancel,
  };
}
