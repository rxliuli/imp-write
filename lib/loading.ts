// @ts-nocheck
import { addDocumentStyle, removeDocumentStyle } from './addStyle'
import { getCaretOffset } from './caret'

export class InputLoader {
  constructor() {
    this.loaderElement = null
    this.isVisible = false
    this.initStyles()
  }

  initStyles() {
    // A constructable stylesheet (not an inline <style>) so it survives a
    // host page whose CSP forbids inline styles — see lib/addStyle.ts.
    addDocumentStyle('input-loader-styles', `
      .input-loader-container {
        position: absolute;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        z-index: 10000;
        pointer-events: none;
      }

      .input-loader-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background-color: #e91e63;
        animation: input-loader-pulse 1.4s ease-in-out infinite;
      }

      .input-loader-dot:nth-child(1) {
        animation-delay: 0s;
      }

      .input-loader-dot:nth-child(2) {
        animation-delay: 0.2s;
      }

      .input-loader-dot:nth-child(3) {
        animation-delay: 0.4s;
      }

      @keyframes input-loader-pulse {
        0%, 60%, 100% {
          opacity: 0.3;
          transform: scale(0.8);
        }
        30% {
          opacity: 1;
          transform: scale(1.2);
        }
      }
    `)
  }

  // 判断是否是可编辑元素
  isEditableElement(element) {
    if (!element) return false

    // 检查是否是 input 或 textarea
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      return true
    }

    // 检查是否是 contenteditable
    if (element.contentEditable === 'true') {
      return true
    }

    // 检查是否在 contenteditable 元素内
    let parent = element.parentElement
    while (parent) {
      if (parent.contentEditable === 'true') {
        return true
      }
      parent = parent.parentElement
    }

    return false
  }

  show(element, options = {}) {
    // 移除已存在的 loader
    this.hide()

    // 检查是否是可编辑元素
    if (!this.isEditableElement(element)) {
      console.warn('Element is not editable:', element)
      return
    }

    // 创建 loader 容器
    this.loaderElement = document.createElement('div')
    this.loaderElement.className = 'input-loader-container'

    // 创建三个点
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div')
      dot.className = 'input-loader-dot'
      this.loaderElement.appendChild(dot)
    }

    // 添加到 body
    document.body.appendChild(this.loaderElement)

    // 计算位置
    this.updatePosition(element, options)

    // 根据元素类型添加不同的事件监听
    const isContentEditable = element.contentEditable === 'true'

    this.inputListener = () => this.updatePosition(element, options)

    if (isContentEditable) {
      // contenteditable 元素的事件
      element.addEventListener('input', this.inputListener)
      element.addEventListener('keyup', this.inputListener)
      element.addEventListener('mouseup', this.inputListener)

      // 监听选区变化
      this.selectionListener = () => {
        if (element.contains(window.getSelection().anchorNode)) {
          this.updatePosition(element, options)
        }
      }
      document.addEventListener('selectionchange', this.selectionListener)
    } else {
      // input/textarea 元素的事件
      element.addEventListener('input', this.inputListener)
      element.addEventListener('keyup', this.inputListener)
      element.addEventListener('click', this.inputListener)
    }

    // 监听窗口滚动和调整大小
    this.scrollListener = () => this.updatePosition(element, options)
    window.addEventListener('scroll', this.scrollListener, true)
    window.addEventListener('resize', this.scrollListener)

    // 保存元素引用
    this.currentElement = element
    this.isCurrentContentEditable = isContentEditable
    this.isVisible = true
  }

  updatePosition(element, options = {}) {
    if (!this.loaderElement) return

    const rect = element.getBoundingClientRect()

    // 光标位置测量逻辑与 lib/hint.ts 共用（见 lib/caret.ts）。取不到时
    // （例如尚无选区）回退到元素起始位置，行为与此前一致。
    const caretPos = getCaretOffset(element) ?? {
      left: 0,
      top: 0,
      lineHeight: 20,
    }

    // 获取样式
    const styles = window.getComputedStyle(element)
    const paddingLeft = parseFloat(styles.paddingLeft) || 0
    const paddingTop = parseFloat(styles.paddingTop) || 0

    // 计算滚动偏移
    let scrollLeft = 0
    let scrollTop = 0

    if (element.scrollLeft !== undefined) {
      scrollLeft = element.scrollLeft
      scrollTop = element.scrollTop || 0
    }

    // 计算 loader 的高度（用于垂直居中）
    const loaderHeight = 6

    // 计算垂直居中的偏移量
    const verticalCenterOffset = (caretPos.lineHeight - loaderHeight) / 2

    // 计算最终位置
    const left =
      rect.left +
      window.scrollX +
      paddingLeft +
      caretPos.left -
      scrollLeft +
      (options.offsetX || 10)
    const top =
      rect.top +
      window.scrollY +
      paddingTop +
      caretPos.top -
      scrollTop +
      verticalCenterOffset +
      (options.offsetY || 0)

    // 设置位置
    this.loaderElement.style.left = `${left}px`
    this.loaderElement.style.top = `${top}px`
  }

  hide() {
    if (this.loaderElement) {
      this.loaderElement.remove()
      this.loaderElement = null
    }

    this.isVisible = false

    if (this.currentElement && this.inputListener) {
      if (this.isCurrentContentEditable) {
        this.currentElement.removeEventListener('input', this.inputListener)
        this.currentElement.removeEventListener('keyup', this.inputListener)
        this.currentElement.removeEventListener('mouseup', this.inputListener)

        if (this.selectionListener) {
          document.removeEventListener(
            'selectionchange',
            this.selectionListener,
          )
          this.selectionListener = null
        }
      } else {
        this.currentElement.removeEventListener('input', this.inputListener)
        this.currentElement.removeEventListener('keyup', this.inputListener)
        this.currentElement.removeEventListener('click', this.inputListener)
      }

      this.currentElement = null
      this.inputListener = null
      this.isCurrentContentEditable = false
    }

    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true)
      window.removeEventListener('resize', this.scrollListener)
      this.scrollListener = null
    }
  }

  destroy() {
    this.hide()
    removeDocumentStyle('input-loader-styles')
    this.isVisible = false
  }

  // 获取当前是否显示 loading 的状态
  get visible() {
    return this.isVisible
  }
}
