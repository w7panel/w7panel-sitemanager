<template>
    <div id="editor_textarea" style="width:100%;border: 1px solid #eaeaea"></div>
</template>

<script>
import {StreamLanguage} from "@codemirror/language"
import {nginx} from "@/assets/js/nginx.js"
import {yaml} from "@/assets/js/yaml.js"
import {ini} from "@/assets/js/ini.js"
import {basicSetup} from "codemirror"
import {indentWithTab} from "@codemirror/commands"
import {EditorView, keymap} from "@codemirror/view"
import {Compartment} from "@codemirror/state"

export default {
    name: "CodeEditor",
    props: ['content', 'language'],
    data(){
        return {
            editor: null,
            languageCompartment: new Compartment()
        }
    },
    watch:{
        content(){
            if(!this.editor){return}
            let txt = this.editor.state.doc.toString();
            if(txt === this.content){return}
            this.editor.dispatch({
                changes: {from: 0, to:txt.length, insert:this.content}
            });
        },
        language(newVal){
            if(!this.editor){return}
            this.updateLanguage(newVal);
        }
    },
    mounted(){
        this.init();
    },
    methods: {
        getLanguageExtension(lang){
            const languageMap = {
                'nginx': nginx,
                'yaml': yaml,
                'ini': ini
            };
            const language = languageMap[lang] || nginx;
            return StreamLanguage.define(language);
        },
        updateLanguage(lang){
            this.editor.dispatch({
                effects: this.languageCompartment.reconfigure(this.getLanguageExtension(lang))
            });
        },
        init(){

            let myTheme = EditorView.theme({
                "&": {
                    height: "486px"
                },
                ".cm-content, .cm-gutter": {minHeight: "435px"},
            });
            
            if(!this.editor){
                document.getElementById("editor_textarea").innerHTML = "";
                this.editor = new EditorView({
                    doc: this.content,
                    extensions: [
                        basicSetup,
                        myTheme,
                        this.languageCompartment.of(this.getLanguageExtension(this.language || 'nginx')),
                        keymap.of([indentWithTab]),
                    ],
                    parent: document.getElementById("editor_textarea"),
                });
                let observe=new MutationObserver(()=>{
                    let txt = this.editor.state.doc.toString();
                    if(txt === this.content){return}
                    this.$emit('update:content', txt);
                });
                observe.observe(document.getElementById("editor_textarea"),{childList:true, characterData:true, subtree:true});
            }

            let txt = this.editor.state.doc.toString();
            if(!txt && this.content){
                this.editor.dispatch({
                    changes: {from: 0, insert:this.content}
                });
            }
        },
    },
}
</script>
