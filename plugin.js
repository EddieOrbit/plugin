(function() {
    'use strict';

    // ================== Конфигурация ==================
    const CACHE_TTL = 3600000; // 1 час кеширования (в мс)
    const sources = {
        animelib: {
            name: "AniLibria",
            url: "https://api.anilibria.tv/v2/getTitle?code={shikimori_id}",
            quality: ["1080p"],
            shikimori: true
        },
        openmovies: {
            name: "OpenMovies",
            url: "https://api.openmovies.ru/v1/movies?kp_id={kp_id}",
            quality: ["4k", "1080p"]
        },
        zetflix: {
            name: "Zetflix",
            url: "https://api.zetflix-internal.workers.dev/movies/{kp_id}?quality=ultrahd",
            quality: ["ultrahd", "fullhd"]
        }
    };

    // ================== Кеширование ==================
    const cache = {
        get: (key) => {
            const data = Lampa.Storage.get(`cache_${key}`);
            if (data && Date.now() - data.timestamp < CACHE_TTL) return data.value;
            return null;
        },
        set: (key, value) => {
            Lampa.Storage.set(`cache_${key}`, {
                value: value,
                timestamp: Date.now()
            });
        }
    };

    // ================== Основные функции ==================
    function addOnlineButton() {
        Lampa.Listener.follow('full', (e) => {
            if (e.type === 'complite' && e.object.activity) {
                const buttonHtml = `
                    <div class="full-start__button selector view--online_custom" data-subtitle="4K Online">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                        </svg>
                        <span>Смотреть онлайн test</span>
                    </div>
                `;

                const button = $(buttonHtml);
                button.on('hover:enter', () => {
                    launchOnlinePlayer(e.data.movie);
                });

                e.object.activity.render().find('.button--play').before(button);
            }
        });
    }

    // ================== Запуск плеера ==================
    async function launchOnlinePlayer(movie) {
        const kpId = movie.kinopoisk_id;
        const imdbId = movie.imdb_id;
        const shikimoriId = await getShikimoriId(movie.original_title);

        if (!kpId && !imdbId && !shikimoriId) {
            Lampa.Noty.show('Ошибка: Не найден ID для поиска');
            return;
        }

        Lampa.Loading.show();
        try {
            const sourcesData = await fetchAllSources(kpId, imdbId, shikimoriId);
            showSourcesModal(sourcesData, movie);
        } catch (e) {
            Lampa.Noty.show('Ошибка загрузки источников');
        } finally {
            Lampa.Loading.hide();
        }
    }

    // ================== Получение данных ==================
    async function fetchAllSources(kpId, imdbId, shikimoriId) {
        const requests = [];

        for (const [key, source] of Object.entries(sources)) {
            const cacheKey = `source_${key}_${kpId || imdbId || shikimoriId}`;
            const cached = cache.get(cacheKey);
            
            if (cached) {
                requests.push(cached);
                continue;
            }

            let url = source.url;
            if (source.shikimori && shikimoriId) {
                url = url.replace('{shikimori_id}', shikimoriId);
            } else if (kpId) {
                url = url.replace('{kp_id}', kpId);
            } else if (imdbId) {
                url = url.replace('{kp_id}', imdbId);
            } else {
                continue;
            }

            requests.push(
                Lampa.Utils.fetch(url)
                    .then(res => res.json())
                    .then(data => {
                        const result = {
                            source: source.name,
                            data: processSourceData(data, source),
                            key: key
                        };
                        cache.set(cacheKey, result);
                        return result;
                    })
                    .catch(() => null)
            );
        }

        return (await Promise.all(requests)).filter(Boolean);
    }

    function processSourceData(data, source) {
        // Обработка разных форматов ответов API
        if (source.key === 'kodik') {
            return data.results.map(item => ({
                url: item.link,
                quality: item.quality,
                voice: item.voice
            }));
        } else if (source.key === 'videocdn') {
            return data.data.map(item => ({
                url: item.iframe_src,
                quality: item.quality
            }));
        }
        return data;
    }

    // ================== Показ модального окна ==================
    function showSourcesModal(sourcesData, movie) {
        let modalHtml = `
            <div class="online-sources-modal">
                <div class="modal__title">Выберите источник</div>
                <div class="modal__subtitle">${movie.title}</div>
                <div class="modal__content">
        `;

        sourcesData.forEach(source => {
            modalHtml += `
                <div class="source-group">
                    <h3>${source.source}</h3>
                    <div class="source-options">
            `;

            const voices = {};
            source.data.forEach(item => {
                const voiceKey = item.voice || 'default';
                if (!voices[voiceKey]) voices[voiceKey] = [];
                voices[voiceKey].push(item);
            });

            Object.entries(voices).forEach(([voice, items]) => {
                const voiceName = sources[source.key]?.voices?.[voice] || voice;
                modalHtml += `
                    <div class="voice-group">
                        <h4>${voiceName}</h4>
                        <div class="quality-options">
                `;

                items.forEach(item => {
                    modalHtml += `
                        <div class="quality-option selector" 
                             data-url="${item.url}" 
                             data-quality="${item.quality}">
                            ${item.quality || 'Unknown'}
                        </div>
                    `;
                });

                modalHtml += `</div></div>`;
            });

            modalHtml += `</div></div>`;
        });

        modalHtml += `</div></div>`;

        const modal = $(modalHtml);
        modal.find('.quality-option').on('hover:enter', function() {
            const url = $(this).data('url');
            const quality = $(this).data('quality');
            playMovie(url, quality, movie.title);
        });

        Lampa.Modal.open({
            title: 'Выбор источника',
            html: modal,
            width: 800,
            onBack: () => Lampa.Modal.close()
        });
    }

    // ================== Воспроизведение ==================
    function playMovie(url, quality, title) {
        Lampa.Player.play({
            url: url,
            title: `${title} (${quality})`,
            quality: quality,
            isonline: true,
            headers: {
                'Referer': 'https://example.com/',
                'Origin': 'https://example.com/'
            }
        });
    }

    // ================== Вспомогательные функции ==================
    async function getShikimoriId(title) {
        if (!title) return null;
        const cacheKey = `shikimori_${title}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        try {
            const response = await Lampa.Utils.fetch(`https://shikimori.one/api/animes?search=${encodeURIComponent(title)}&limit=1`);
            const data = await response.json();
            if (data.length > 0) {
                cache.set(cacheKey, data[0].id);
                return data[0].id;
            }
        } catch (e) {
            console.error('Shikimori API error:', e);
        }
        return null;
    }

    // ================== Инициализация ==================
    if (!window.lampa_custom_online_plus) {
        window.lampa_custom_online_plus = true;
        addOnlineButton();
        
        // Добавляем стили
        const css = `
            .online-sources-modal {
                padding: 20px;
                max-height: 70vh;
                overflow-y: auto;
            }
            .source-group {
                margin-bottom: 20px;
                background: rgba(255,255,255,0.1);
                padding: 15px;
                border-radius: 8px;
            }
            .voice-group {
                margin: 10px 0;
            }
            .quality-options {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 5px;
            }
            .quality-option {
                padding: 8px 12px;
                background: rgba(255,255,255,0.2);
                border-radius: 4px;
                cursor: pointer;
            }
            .quality-option:hover, .quality-option.focus {
                background: rgba(255,255,255,0.4);
            }
        `;
        $('head').append(`<style>${css}</style>`);
    }
})();
