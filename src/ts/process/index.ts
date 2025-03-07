import { get, writable } from "svelte/store";
import { DataBase, setDatabase, type character } from "../storage/database";
import { CharEmotion, selectedCharID } from "../stores";
import { ChatTokenizer, tokenizeNum } from "../tokenizer";
import { language } from "../../lang";
import { alertError } from "../alert";
import { loadLoreBookPrompt } from "./lorebook";
import { findCharacterbyId, replacePlaceholders } from "../util";
import { requestChatData } from "./request";
import { stableDiff } from "./stableDiff";
import { processScript, processScriptFull } from "./scripts";
import { exampleMessage } from "./exampleMessages";
import { sayTTS } from "./tts";
import { supaMemory } from "./supaMemory";
import { v4 } from "uuid";
import { cloneDeep } from "lodash";
import { groupOrder } from "./group";

export interface OpenAIChat{
    role: 'system'|'user'|'assistant'|'function'
    content: string
    memo?:string
    name?:string
}

export interface OpenAIChatFull extends OpenAIChat{
    function_call?: {
        name: string
        arguments:string
    }

}

export const doingChat = writable(false)

export async function sendChat(chatProcessIndex = -1,arg:{chatAdditonalTokens?:number} = {}):Promise<boolean> {

    let findCharCache:{[key:string]:character} = {}
    function findCharacterbyIdwithCache(id:string){
        const d = findCharCache[id]
        if(!!d){
            return d
        }
        else{
            const r = findCharacterbyId(id)
            findCharCache[id] = r
            return r
        }
    }

    function reformatContent(data:string){
        return data.trim().replace(`${currentChar.name}:`, '').trim()
    }

    let isDoing = get(doingChat)

    if(isDoing){
        if(chatProcessIndex === -1){
            return false
        }
    }
    doingChat.set(true)

    let db = get(DataBase)
    let selectedChar = get(selectedCharID)
    const nowChatroom = db.characters[selectedChar]
    let currentChar:character
    let caculatedChatTokens = 0
    if(db.aiModel.startsWith('gpt')){
        caculatedChatTokens += 5
    }
    else{
        caculatedChatTokens += 3
    }

    if(nowChatroom.type === 'group'){
        if(chatProcessIndex === -1){
            const charNames =nowChatroom.characters.map((v) => findCharacterbyIdwithCache(v).name)

            const messages = nowChatroom.chats[nowChatroom.chatPage].message
            const lastMessage = messages[messages.length-1]
            let order = nowChatroom.characters.map((v,i) => {
                return {
                    id: v,
                    talkness: nowChatroom.characterActive[i] ? nowChatroom.characterTalks[i] : -1,
                    index: i
                }
            }).filter((v) => {
                return v.talkness > 0
            })
            if(!nowChatroom.orderByOrder){
                order = groupOrder(order, lastMessage?.data).filter((v) => {
                    if(v.id === lastMessage?.saying){
                        return false
                    }
                    return true
                })
            }
            for(let i=0;i<order.length;i++){
                const r = await sendChat(order[i].index, {
                    chatAdditonalTokens: caculatedChatTokens
                })
                if(!r){
                    return false
                }
            }
            return true
        }
        else{
            currentChar = findCharacterbyIdwithCache(nowChatroom.characters[chatProcessIndex])
            if(!currentChar){
                alertError(`cannot find character: ${nowChatroom.characters[chatProcessIndex]}`)
                return false
            }
        }
    }
    else{
        currentChar = nowChatroom
    }

    let chatAdditonalTokens = arg.chatAdditonalTokens ?? caculatedChatTokens
    const tokenizer = new ChatTokenizer(chatAdditonalTokens, db.aiModel.startsWith('gpt') ? 'noName' : 'name')
    let selectedChat = nowChatroom.chatPage
    let currentChat = nowChatroom.chats[selectedChat]
    let maxContextTokens = db.maxContext

    if(db.aiModel === 'gpt35'){
        if(maxContextTokens > 4000){
            maxContextTokens = 4000
        }
    }
    if(db.aiModel === 'gpt35_16k' || db.aiModel === 'gpt35_16k_0613'){
        if(maxContextTokens > 16000){
            maxContextTokens = 16000
        }
    }
    if(db.aiModel === 'gpt4'){
        if(maxContextTokens > 8000){
            maxContextTokens = 8000
        }
    }
    if(db.aiModel === 'deepai'){
        if(maxContextTokens > 3000){
            maxContextTokens = 3000
        }
    }


    let unformated = {
        'main':([] as OpenAIChat[]),
        'jailbreak':([] as OpenAIChat[]),
        'chats':([] as OpenAIChat[]),
        'lorebook':([] as OpenAIChat[]),
        'globalNote':([] as OpenAIChat[]),
        'authorNote':([] as OpenAIChat[]),
        'lastChat':([] as OpenAIChat[]),
        'description':([] as OpenAIChat[]),
        'postEverything':([] as OpenAIChat[]),
    }

    if(!currentChar.utilityBot){
        const mainp = currentChar.systemPrompt?.replaceAll('{{original}}', db.mainPrompt) || db.mainPrompt


        function formatPrompt(data:string){
            if(!data.startsWith('@@@')){
                data = "@@@system\n" + data
            }
            const parts = data.split(/@@@(user|assistant|system)\n/);
  
            // Initialize empty array for the chat objects
            const chatObjects: OpenAIChat[] = [];
            
            // Loop through the parts array two elements at a time
            for (let i = 1; i < parts.length; i += 2) {
              const role = parts[i] as 'user' | 'assistant' | 'system';
              const content = parts[i + 1]?.trim() || '';
              chatObjects.push({ role, content });
            }

            console.log(chatObjects)
            return chatObjects;
        }

        unformated.main.push(...formatPrompt(replacePlaceholders(mainp + ((db.additionalPrompt === '' || (!db.promptPreprocess)) ? '' : `\n${db.additionalPrompt}`), currentChar.name)))
    
        if(db.jailbreakToggle){
            unformated.jailbreak.push(...formatPrompt(replacePlaceholders(db.jailbreak, currentChar.name)))
        }
    
        unformated.globalNote.push(...formatPrompt(replacePlaceholders(currentChar.replaceGlobalNote?.replaceAll('{{original}}', db.globalNote) || db.globalNote, currentChar.name)))
    }

    if(currentChat.note){
        unformated.authorNote.push({
            role: 'system',
            content: replacePlaceholders(currentChat.note, currentChar.name)
        })
    }

    {
        let description = replacePlaceholders((db.promptPreprocess ? db.descriptionPrefix: '') + currentChar.desc, currentChar.name)

        if(currentChar.personality){
            description += replacePlaceholders("\n\nDescription of {{char}}: " + currentChar.personality,currentChar.name)
        }

        if(currentChar.scenario){
            description += replacePlaceholders("\n\nCircumstances and context of the dialogue: " + currentChar.scenario,currentChar.name)
        }

        unformated.description.push({
            role: 'system',
            content: description
        })

        if(nowChatroom.type === 'group'){
            const systemMsg = `[Write the next reply only as ${currentChar.name}]`
            unformated.postEverything.push({
                role: 'system',
                content: systemMsg
            })
        }
    }

    unformated.lorebook.push({
        role: 'system',
        content: replacePlaceholders(await loadLoreBookPrompt(), currentChar.name)
    })

    //await tokenize currernt
    let currentTokens = db.maxResponse
    
    for(const key in unformated){
        const chats = unformated[key] as OpenAIChat[]
        for(const chat of chats){
            currentTokens += await tokenizer.tokenizeChat(chat)
        }
    }

    
    const examples = exampleMessage(currentChar, db.username)

    for(const example of examples){
        currentTokens += await tokenizer.tokenizeChat(example)
    }

    let chats:OpenAIChat[] = examples

    
    chats.push({
        role: 'system',
        content: '[Start a new chat]',
        memo: "NewChat"
    })

    if(nowChatroom.type !== 'group'){
        const firstMsg = nowChatroom.firstMsgIndex === -1 ? nowChatroom.firstMessage : nowChatroom.alternateGreetings[nowChatroom.firstMsgIndex]

        const chat:OpenAIChat = {
            role: 'assistant',
            content: processScript(nowChatroom,
                replacePlaceholders(firstMsg, currentChar.name),
            'editprocess')
        }
        chats.push(chat)
        currentTokens += await tokenizer.tokenizeChat(chat)
    }

    const ms = currentChat.message
    for(const msg of ms){
        let formedChat = processScript(nowChatroom,replacePlaceholders(msg.data, currentChar.name), 'editprocess')
        let name = ''
        if(msg.role === 'char'){
            if(msg.saying){
                name = `${findCharacterbyIdwithCache(msg.saying).name}`
            }
            else{
                name = `${currentChar.name}`
            }
        }
        else if(msg.role === 'user'){
            name = `${db.username}`
        }
        if(!msg.chatId){
            msg.chatId = v4()
        }
        const chat:OpenAIChat = {
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: formedChat,
            memo: msg.chatId,
            name: name
        }
        chats.push(chat)
        currentTokens += await tokenizer.tokenizeChat(chat)
    }

    if(nowChatroom.supaMemory && db.supaMemoryType !== 'none'){
        const sp = await supaMemory(chats, currentTokens, maxContextTokens, currentChat, nowChatroom, tokenizer)
        if(sp.error){
            alertError(sp.error)
            return false
        }
        chats = sp.chats
        currentTokens = sp.currentTokens
        currentChat.supaMemoryData = sp.memory ?? currentChat.supaMemoryData
        currentChat.lastMemory = sp.lastId ?? currentChat.lastMemory
    }
    else{
        while(currentTokens > maxContextTokens){
            if(chats.length <= 1){
                alertError(language.errors.toomuchtoken + "\n\nRequired Tokens: " + currentTokens)

                return false
            }

            currentTokens -= await tokenizer.tokenizeChat(chats[0])
            chats.splice(0, 1)
        }
        currentChat.lastMemory = chats[0].memo
    }
    let bias:{[key:number]:number} = {}

    for(let i=0;i<currentChar.bias.length;i++){
        const bia = currentChar.bias[i]
        const tokens = await tokenizeNum(bia[0])

        for(const token of tokens){
            bias[token] = bia[1]
        }
    }

    for(let i=0;i<db.bias.length;i++){
        const bia = db.bias[i]
        const tokens = await tokenizeNum(bia[0])

        for(const token of tokens){
            bias[token] = bia[1]
        }
    }


    unformated.lastChat.push(chats[chats.length - 1])
    chats.splice(chats.length - 1, 1)

    unformated.chats = chats

    //make into one

    let formated:OpenAIChat[] = []
    const formatOrder = cloneDeep(db.formatingOrder)
    formatOrder.push('postEverything')
    let sysPrompts:string[] = []
    for(let i=0;i<formatOrder.length;i++){
        const cha = unformated[formatOrder[i]]
        if(cha.length === 1 && cha[0].role === 'system'){
            sysPrompts.push(cha[0].content)
        }
        else if(sysPrompts.length > 0){
            const prompt = sysPrompts.join('\n')

            if(prompt.replace(/\n/g,'').length > 3){
                formated.push({
                    role: 'system',
                    content: prompt
                })
            }
            sysPrompts = []
            formated = formated.concat(cha)
        }
        else{
            formated = formated.concat(cha)
        }
    }

    if(sysPrompts.length > 0){
        const prompt = sysPrompts.join('\n')

        if(prompt.replace(/\n/g,'').length > 3){
            formated.push({
                role: 'system',
                content: prompt
            })
        }
        sysPrompts = []
    }



    for(let i=0;i<formated.length;i++){
        formated[i].memo = undefined
    }

    const req = await requestChatData({
        formated: formated,
        bias: bias,
        currentChar: currentChar,
        useStreaming: true,
        isGroupChat: nowChatroom.type === 'group'
    }, 'model')

    let result = ''
    let emoChanged = false

    if(req.type === 'fail'){
        alertError(req.result)
        return false
    }
    else if(req.type === 'streaming'){
        const reader = req.result.getReader()
        const msgIndex = db.characters[selectedChar].chats[selectedChat].message.length
        db.characters[selectedChar].chats[selectedChat].isStreaming = true
        db.characters[selectedChar].chats[selectedChat].message.push({
            role: 'char',
            data: "",
            saying: currentChar.chaId
        })
        while(true){
            const readed = (await reader.read())
            if(readed.value){
                result = readed.value
                const result2 = processScriptFull(nowChatroom, reformatContent(result), 'editoutput')
                db.characters[selectedChar].chats[selectedChat].message[msgIndex].data = result2.data
                emoChanged = result2.emoChanged
                setDatabase(db)
            }
            if(readed.done){
                db.characters[selectedChar].chats[selectedChat].isStreaming = false
                setDatabase(db)
                break
            }   
        }
        await sayTTS(currentChar, result)
    }
    else{
        const result2 = processScriptFull(nowChatroom, reformatContent(req.result), 'editoutput')
        result = result2.data
        emoChanged = result2.emoChanged
        db.characters[selectedChar].chats[selectedChat].message.push({
            role: 'char',
            data: result,
            saying: currentChar.chaId
        })
        await sayTTS(currentChar, result)
        setDatabase(db)
    }

    if(req.special){
        if(req.special.emotion){
            let charemotions = get(CharEmotion)
            let currentEmotion = currentChar.emotionImages

            let tempEmotion = charemotions[currentChar.chaId]
            if(!tempEmotion){
                tempEmotion = []
            }
            if(tempEmotion.length > 4){
                tempEmotion.splice(0, 1)
            }

            for(const emo of currentEmotion){
                if(emo[0] === req.special.emotion){
                    const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                    tempEmotion.push(emos)
                    charemotions[currentChar.chaId] = tempEmotion
                    CharEmotion.set(charemotions)
                    emoChanged = true
                    break
                }
            }
        }
    }

    if(currentChar.viewScreen === 'emotion' && (!emoChanged)){

        let currentEmotion = currentChar.emotionImages

        function shuffleArray(array:string[]) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array
        }

        let emotionList = currentEmotion.map((a) => {
            return a[0]
        })

        let charemotions = get(CharEmotion)

        let tempEmotion = charemotions[currentChar.chaId]
        if(!tempEmotion){
            tempEmotion = []
        }
        if(tempEmotion.length > 4){
            tempEmotion.splice(0, 1)
        }

        let emobias:{[key:number]:number} = {}

        for(const emo of emotionList){
            const tokens = await tokenizeNum(emo)
            for(const token of tokens){
                emobias[token] = 10
            }
        }

        for(let i =0;i<tempEmotion.length;i++){
            const emo = tempEmotion[i]

            const tokens = await tokenizeNum(emo[0])
            const modifier = 20 - ((tempEmotion.length - (i + 1)) * (20/4))

            for(const token of tokens){
                emobias[token] -= modifier
                if(emobias[token] < -100){
                    emobias[token] = -100
                }
            }
        }        

        const promptbody:OpenAIChat[] = [
            {
                role:'system',
                content: `${db.emotionPrompt2 || "From the list below, choose a word that best represents a character's outfit description, action, or emotion in their dialogue. Prioritize selecting words related to outfit first, then action, and lastly emotion. Print out the chosen word."}\n\n list: ${shuffleArray(emotionList).join(', ')} \noutput only one word.`
            },
            {
                role: 'user',
                content: `"Good morning, Master! Is there anything I can do for you today?"`
            },
            {
                role: 'assistant',
                content: 'happy'
            },
            {
                role: 'user',
                content: result
            },
        ]

        const rq = await requestChatData({
            formated: promptbody,
            bias: emobias,
            currentChar: currentChar,
            temperature: 0.4,
            maxTokens: 30,
        }, 'submodel')

        if(rq.type === 'fail' || rq.type === 'streaming'){
            alertError(`${rq.result}`)
            return true
        }
        else{
            emotionList = currentEmotion.map((a) => {
                return a[0]
            })
            try {
                const emotion:string = rq.result.replace(/ |\n/g,'').trim().toLocaleLowerCase()
                let emotionSelected = false
                for(const emo of currentEmotion){
                    if(emo[0] === emotion){
                        const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                        tempEmotion.push(emos)
                        charemotions[currentChar.chaId] = tempEmotion
                        CharEmotion.set(charemotions)
                        emotionSelected = true
                        break
                    }
                }
                if(!emotionSelected){
                    for(const emo of currentEmotion){
                        if(emotion.includes(emo[0])){
                            const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                            tempEmotion.push(emos)
                            charemotions[currentChar.chaId] = tempEmotion
                            CharEmotion.set(charemotions)
                            emotionSelected = true
                            break
                        }
                    }
                }
                if(!emotionSelected && emotionList.includes('neutral')){
                    const emo = currentEmotion[emotionList.indexOf('neutral')]
                    const emos:[string, string,number] = [emo[0], emo[1], Date.now()]
                    tempEmotion.push(emos)
                    charemotions[currentChar.chaId] = tempEmotion
                    CharEmotion.set(charemotions)
                    emotionSelected = true
                }
            } catch (error) {
                alertError(language.errors.httpError + `${error}`)
                return true
            }
        }
        
        return true


    }
    else if(currentChar.viewScreen === 'imggen'){
        if(chatProcessIndex !== -1){
            alertError("Stable diffusion in group chat is not supported")
        }

        const msgs = db.characters[selectedChar].chats[selectedChat].message
        let msgStr = ''
        for(let i = (msgs.length - 1);i>=0;i--){
            console.log(i,msgs.length,msgs[i])
            if(msgs[i].role === 'char'){
                msgStr = `character: ${msgs[i].data.replace(/\n/, ' ')} \n` + msgStr
            }
            else{
                msgStr = `user: ${msgs[i].data.replace(/\n/, ' ')} \n` + msgStr
                break
            }
        }


        const ch = await stableDiff(currentChar, msgStr)
        if(ch){
            db.characters[selectedChar].chats[selectedChat].sdData = ch
            setDatabase(db)
        }
    }
    return true
}