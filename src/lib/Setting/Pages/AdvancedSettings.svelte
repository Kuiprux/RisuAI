<script lang="ts">
    import Check from "src/lib/Others/Check.svelte";
    import { language } from "src/lang";
    import { DataBase } from "src/ts/storage/database";
    import { alertMd } from "src/ts/alert";
    import { getRequestLog, isTauri } from "src/ts/storage/globalApi";
</script>
<h2 class="text-2xl font-bold mt-2">{language.advancedSettings}</h2>
<span class="text-draculared text-xs mb-2">{language.advancedSettingsWarn}</span>
<span class="text-neutral-200 mt-4 mb-2">{language.loreBookDepth}</span>
<input class="text-neutral-200 mb-4 p-2 bg-transparent input-text focus:bg-selected text-sm" type="number" min={0} max="20" bind:value={$DataBase.loreBookDepth}>
<span class="text-neutral-200">{language.loreBookToken}</span>
<input class="text-neutral-200 mb-4 p-2 bg-transparent input-text focus:bg-selected text-sm" type="number" min={0} max="4096" bind:value={$DataBase.loreBookToken}>

<span class="text-neutral-200">{language.additionalPrompt}</span>
<input class="text-neutral-200 mb-4 p-2 bg-transparent input-text focus:bg-selected text-sm"bind:value={$DataBase.additionalPrompt}>

<span class="text-neutral-200">{language.descriptionPrefix}</span>
<input class="text-neutral-200 mb-4 p-2 bg-transparent input-text focus:bg-selected text-sm"bind:value={$DataBase.descriptionPrefix}>

<span class="text-neutral-200">{language.emotionPrompt}</span>
<input class="text-neutral-200 mb-4 p-2 bg-transparent input-text focus:bg-selected text-sm"bind:value={$DataBase.emotionPrompt2} placeholder="Leave it blank to use default">

<span class="text-neutral-200">{language.requestretrys}</span>
<input class="text-neutral-200 mb-4 p-2 bg-transparent input-text focus:bg-selected text-sm" type="number" min={0} max="20" bind:value={$DataBase.requestRetrys}>

<span class="text-neutral-200">Request Lib</span>
<select class="bg-transparent input-text text-gray-200 appearance-none text-sm" bind:value={$DataBase.requester}>
    <option value="new" class="bg-darkbg appearance-none">Reqwest</option>
    <option value="old" class="bg-darkbg appearance-none">Tauri</option>
</select>

<div class="flex items-center mt-4">
    <Check bind:check={$DataBase.useSayNothing} name={language.sayNothing}/>
</div>
<div class="flex items-center mt-4">
    <Check bind:check={$DataBase.showUnrecommended} name={language.showUnrecommended}/>
</div>
<div class="flex items-center mt-4">
    <Check bind:check={$DataBase.imageCompression} name={language.imageCompression}/>
</div>
<div class="flex items-center mt-4">
    <Check bind:check={$DataBase.useExperimental} name={language.useExperimental}/>
</div>
<div class="flex items-center mt-4">
    <Check bind:check={$DataBase.usePlainFetch} name="Force Plain Fetch"/>
</div>
<button
    on:click={async () => {
        alertMd(getRequestLog())
    }}
    class="drop-shadow-lg p-3 border-borderc border-solid mt-6 flex justify-center items-center ml-2 mr-2 border-1 hover:bg-selected text-sm">
    {language.ShowLog}
</button>
