<script lang="ts">
    import { language } from "src/lang";
  import Help from "src/lib/Others/Help.svelte";
    import { hubURL } from "src/ts/characterCards";
    import { getCharImage, selectUserImg } from "src/ts/characters";
    import { loadRisuAccountData, saveRisuAccountData } from "src/ts/drive/accounter";
    import { checkDriver } from "src/ts/drive/drive";
    import { DataBase } from "src/ts/storage/database";
    let openIframe = false
    let openIframeURL = ''
    let popup:Window = null
</script>

<svelte:window on:message={async (e) => {
    if(e.origin.startsWith("https://sv.risuai.xyz") || e.origin.startsWith("http://127.0.0.1")){
        if(e.data.msg.type === 'drive'){
            console.log(e.data.msg)
            await loadRisuAccountData()
            $DataBase.account.data.refresh_token = e.data.msg.data.refresh_token
            $DataBase.account.data.access_token = e.data.msg.data.access_token
            $DataBase.account.data.expires_in = (e.data.msg.data.expires_in * 700) + Date.now()
            await saveRisuAccountData()
            popup.close()
        }
        else if(e.data.msg.data.vaild){
            openIframe = false
            $DataBase.account = {
                id: e.data.msg.id,
                token: e.data.msg.token,
                data: e.data.msg.data
            }
        }
    }
}}></svelte:window>

<h2 class="mb-2 text-2xl font-bold mt-2">{language.user}</h2>

<span class="text-neutral-200 mt-2 mb-2">{language.userIcon}</span>
<button on:click={() => {selectUserImg()}}>
    {#if $DataBase.userIcon === ''}
        <div class="rounded-md h-32 w-32 shadow-lg bg-gray-500 cursor-pointer hover:text-green-500" />
    {:else}
        {#await getCharImage($DataBase.userIcon, 'css')}
            <div class="rounded-md h-32 w-32 shadow-lg bg-gray-500 cursor-pointer hover:text-green-500" />
        {:then im} 
            <div class="rounded-md h-32 w-32 shadow-lg bg-gray-500 cursor-pointer hover:text-green-500" style={im} />                
        {/await}
    {/if}
</button>
<span class="text-neutral-200 mt-4">{language.username}</span>
<input class="text-neutral-200 mt-2 mb-4 p-2 bg-transparent input-text focus:bg-selected" placeholder="User" bind:value={$DataBase.username}>
    <div class="bg-darkbg p-3 rounded-md mb-2 flex flex-col items-start">
        <div class="w-full">
            <h1 class="text-3xl font-black min-w-0">Risu Account{#if $DataBase.account}
                <button class="bg-selected p-1 text-sm font-light rounded-md hover:bg-green-500 transition-colors float-right" on:click={async () => {
                    $DataBase.account = undefined
                }}>Logout</button>
            {/if}</h1>
        </div>
        {#if $DataBase.account}
            <span class="mb-4 text-gray-400">ID: {$DataBase.account.id}</span>
            {#if $DataBase.useExperimental}

                <h1 class="text-xl font-bold mt-2">{language.googleDriveConnection} <Help key="experimental"/></h1>
                {#if !$DataBase.account.data.refresh_token}
                    <span class="text-sm font-light mb-2 text-gray-400">{language.googleDriveInfo}</span>
                    <button class="bg-selected p-2 rounded-md hover:bg-green-500 transition-colors" on:click={async () => {
                        if((!popup) || popup.closed){
                            popup = window.open(await checkDriver('reftoken'))                    
                        }
                    }}>
                        Connect to Google Drive
                    </button>
                {:else}
                    <span class="text-sm font-light mb-2 text-gray-400">{language.googleDriveConnected}</span>
                {/if}
            {/if}

        {:else}
            <span>{language.notLoggedIn}</span>
            <button class="bg-selected p-2 rounded-md mt-2 hover:bg-green-500 transition-colors" on:click={() => {
                openIframeURL = hubURL + '/hub/login'
                openIframe = true
            }}>
                Login
            </button>
        {/if}
    </div>
{#if openIframe}
    <div class="fixed top-0 left-0 bg-black bg-opacity-50 w-full h-full flex justify-center items-center">
        <iframe src={openIframeURL} title="login" class="w-full h-full">
        </iframe>
    </div>
{/if}