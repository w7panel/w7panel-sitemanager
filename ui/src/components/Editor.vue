<template>
  <div ref="editor" class="editor"></div>
</template>

<script>
import { indentWithTab } from '@codemirror/commands'
import { StreamLanguage } from '@codemirror/language'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { nginx } from '@/assets/js/nginx'

export default {
  name: 'CodeEditor',
  props: {
    content: {
      type: String,
      default: ''
    }
  },
  emits: ['update:content'],
  data() {
    return {
      editor: null
    }
  },
  watch: {
    content(value) {
      if (!this.editor || this.editor.state.doc.toString() === value) return
      this.editor.dispatch({
        changes: {
          from: 0,
          to: this.editor.state.doc.length,
          insert: value
        }
      })
    }
  },
  mounted() {
    const theme = EditorView.theme({
      '&': { height: '486px' },
      '.cm-content, .cm-gutter': { minHeight: '435px' }
    })

    this.editor = new EditorView({
      doc: this.content,
      extensions: [
        basicSetup,
        theme,
        StreamLanguage.define(nginx),
        keymap.of([indentWithTab]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            this.$emit('update:content', update.state.doc.toString())
          }
        })
      ],
      parent: this.$refs.editor
    })
  },
  beforeUnmount() {
    this.editor?.destroy()
  }
}
</script>

<style scoped>
.editor {
  width: 100%;
  border: 1px solid #eaeaea;
}
</style>
