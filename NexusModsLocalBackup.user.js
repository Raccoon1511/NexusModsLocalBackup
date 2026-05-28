// ==UserScript==
// @name         Nexus Mod Local Backup Button
// @author       Raccoon1511
// @namespace    http://tampermonkey.net/
// @version      2.8
// @description  Adds a "Backup Mod" button to mod pages, mod cards, and search results. Saves everything into a subfolder named exactly after the mod inside your Downloads folder.
// @match        https://www.nexusmods.com/*
// @match        https://next.nexusmods.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      api.nexusmods.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // --- SCRIPT CORE ---

    function apiRequest(endpoint) {
        return new Promise((resolve, reject) => {
            let savedKey = GM_getValue("nexus_api_key", "");

            if (!savedKey || savedKey.trim() === "") {
                const userKey = prompt("Please enter your Nexus Mods API Key.\n(This will be saved securely in Tampermonkey and you won't have to enter it again):");

                if (!userKey) {
                    reject("Backup cancelled. An API key is required.");
                    return;
                }

                savedKey = userKey.trim();
                GM_setValue("nexus_api_key", savedKey);
            }

            const cleanKey = savedKey.replace(/[\s'"]/g, '');

            GM_xmlhttpRequest({
                method: "GET",
                url: `https://api.nexusmods.com/v1${endpoint}`,
                headers: {
                    "apikey": cleanKey,
                    "accept": "application/json"
                },
                anonymous: true,
                onload: function(response) {
                    if (response.status === 401) {
                        GM_setValue("nexus_api_key", "");
                        reject("Nexus rejected this API key. It has been cleared; please try again and double-check your key.");
                    } else if (response.status !== 200) {
                        reject(`API Error ${response.status}`);
                    } else {
                        resolve(JSON.parse(response.responseText));
                    }
                },
                onerror: function(err) {
                    reject(`Network Error: ${err}`);
                }
            });
        });
    }

    function cleanFilename(filename) {
        return filename.replace(/[\\/*?:"<>|]/g, "").replace(/\s+/g, " ").trim();
    }

    function downloadFile(url, relativePath) {
        return new Promise((resolve, reject) => {
            GM_download({
                url: url,
                name: relativePath,
                saveAs: false,
                onload: () => resolve(),
                onerror: (err) => {
                    console.error(`[Backup Script] Failed to download ${relativePath}`, err);
                    resolve();
                }
            });
        });
    }

    async function processModBackup(gameDomain, modId, uiStatusElement) {
        try {
            uiStatusElement.innerText = "Reading Mod Name...";

            const modData = await apiRequest(`/games/${gameDomain}/mods/${modId}`);
            const modName = cleanFilename(modData.name || `Mod_${modId}`);
            const folderPrefix = `${modName}/`;

            uiStatusElement.innerText = "Saving Info...";

            const cleanDescription = (modData.description || "No description available.")
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');

            const instructionsText = `Mod Name: ${modData.name}\nAuthor: ${modData.author}\nVersion: ${modData.version}\nURL: https://www.nexusmods.com/${gameDomain}/mods/${modId}\n----------------------------------------\n\n${cleanDescription}`;

            const blob = new Blob([instructionsText], { type: "text/plain" });
            const blobUrl = URL.createObjectURL(blob);
            await downloadFile(blobUrl, `${folderPrefix}instructions.txt`);

            if (modData.picture_url) {
                let ext = modData.picture_url.split('.').pop().split('?')[0];
                if (ext.length > 4 || !/^[a-zA-Z0-9]+$/.test(ext)) ext = "jpg";
                await downloadFile(modData.picture_url, `${folderPrefix}preview_image.${ext}`);
            }

            uiStatusElement.innerText = "Fetching Files...";
            const filesData = await apiRequest(`/games/${gameDomain}/mods/${modId}/files`);

            if (!filesData || !filesData.files || filesData.files.length === 0) {
                uiStatusElement.innerText = "No Files Found!";
                return;
            }

            for (const modFile of filesData.files) {
                const categoryName = modFile.category_name || 'Unknown';
                const catLower = categoryName.toLowerCase();

                const isOldOrArchived = (modFile.category_id === 4 || modFile.category_id === 6 || catLower.includes('old') || catLower.includes('archive'));
                if (isOldOrArchived) continue;

                uiStatusElement.innerText = `Downloading Files...`;

                const linksData = await apiRequest(`/games/${gameDomain}/mods/${modId}/files/${modFile.file_id}/download_link`);
                if (linksData && linksData.length > 0) {
                    const downloadUrl = linksData[0].URI;
                    const savePath = `${folderPrefix}${cleanFilename(categoryName)}/${modFile.file_name}`;
                    await downloadFile(downloadUrl, savePath);
                }
            }

            uiStatusElement.innerText = "Success!";
            setTimeout(() => { uiStatusElement.innerText = "Local Backup"; }, 3000);

        } catch (error) {
            console.error("[Backup Script] Error Details:", error);
            uiStatusElement.innerText = "Failed";
            setTimeout(() => { uiStatusElement.innerText = "Local Backup"; }, 3000);
            alert(`Backup failed:\n${error}`);
        }
    }

    // --- UI INJECTION FOR DETAIL PAGE ---
    function injectButton() {
        const actionList = document.querySelector('.action-list') ||
                           document.querySelector('.mod-actions') ||
                           document.querySelector('ul.actions') ||
                           document.querySelector('.page-header-actions');

        if (!actionList || document.getElementById('local-backup-btn')) return;

        const urlParts = window.location.pathname.split('/');
        if (!urlParts.includes('mods') || urlParts[urlParts.length - 1] === 'mods') return;

        const modsIdx = urlParts.indexOf('mods');
        const gameDomain = urlParts[modsIdx - 1];
        const modId = urlParts[modsIdx + 1];

        if (!gameDomain || !modId || isNaN(modId)) return;

        const backupBtn = document.createElement('li');
        backupBtn.id = 'local-backup-btn';
        backupBtn.className = 'nav-item';
        backupBtn.innerHTML = `
            <a class="btn inline-flex" style="background-color: #7289da; color: white; cursor: pointer; margin-left: 8px; padding: 10px 18px; align-items: center; border-radius: 4px; display: inline-flex;">
                <span class="text" style="color: white !important; font-weight: 600; font-size: 14px;">Local Backup</span>
            </a>
        `;

        backupBtn.addEventListener('click', (e) => {
            e.preventDefault();
            processModBackup(gameDomain, modId, backupBtn.querySelector('.text'));
        });

        actionList.appendChild(backupBtn);
    }

    // --- UI INJECTION FOR MOD CARDS (SEARCH / LISTINGS) ---
    function injectCardButtons() {
        // Targets classic mod tiles, newer Next.js grids, and global search result grids
        const cards = document.querySelectorAll(`
            .mod-tile:not(.has-backup-btn),
            .mods-grid > div:not(.animate-pulse):not(.has-backup-btn),
            #mainContent section[aria-label="Mods"] .grid > div:not(.animate-pulse):not(.has-backup-btn),
            #mainContent .grid > div.flex.flex-col:not(.animate-pulse):not(.has-backup-btn)
        `);

        cards.forEach(card => {
            // Find a link that points to a specific mod inside the card
            const link = card.querySelector('a[href*="/mods/"]');
            if (!link) return;

            try {
                const urlObj = new URL(link.href, window.location.origin);
                const parts = urlObj.pathname.split('/').filter(p => p);
                const modsIdx = parts.indexOf('mods');

                // Extract domain and ID cleanly from the path structure
                if (modsIdx > 0 && parts.length > modsIdx + 1) {
                    const gameDomain = parts[modsIdx - 1];
                    const modId = parts[modsIdx + 1].split('?')[0];

                    // Ensure the ID is numeric (filters out links to generic /mods/ pages)
                    if (!/^\d+$/.test(modId)) return;

                    card.classList.add('has-backup-btn');

                    const btnContainer = document.createElement('div');
                    btnContainer.style.padding = '8px';
                    btnContainer.style.display = 'flex';
                    btnContainer.style.justifyContent = 'center';
                    btnContainer.style.marginTop = 'auto'; // Ensures the button sticks to the bottom of the card

                    const btn = document.createElement('button');
                    btn.innerText = 'Local Backup';
                    btn.style.cssText = 'background-color: #7289da; color: white; cursor: pointer; padding: 6px 12px; border: none; border-radius: 4px; font-weight: 600; font-size: 13px; width: 100%; transition: opacity 0.2s;';

                    btn.onmouseover = () => btn.style.opacity = '0.8';
                    btn.onmouseout = () => btn.style.opacity = '1';

                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        processModBackup(gameDomain, modId, btn);
                    });

                    btnContainer.appendChild(btn);
                    card.appendChild(btnContainer);
                }
            } catch (e) {
                // Failsafe for malformed URLs
            }
        });
    }

    // --- OBSERVER ---
    const observer = new MutationObserver(() => {
        injectButton();
        injectCardButtons();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Initial Run
    injectButton();
    injectCardButtons();

})();