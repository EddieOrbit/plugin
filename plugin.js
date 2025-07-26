(function() {
    'use strict';

    // Проверяем наличие необходимых объектов Lampa
    if (!window.Lampa || !Lampa.Storage || !Lampa.Listener) {
        console.error('Lampa API не доступна! Плагин не может работать.');
        return;
    }

    // ================== Конфигурация ==================
    const CACHE_TTL = 3600000; // 1 час кеширования
    const PLUGIN_NAME = 'custom_online_plus';
    const sources = {
        animelib: {
            name: "AniLibria",
            url: "https://api.anilibria.tv/v2/getTitle?code={shikimori_id}",
            quality: ["1080p"],
            shikimori: true
        },
        kodik: {
            name: "Kodik",
            url: "https://kodikapi.com/search?token=YOUR_TOKEN&shikimori_id={shikimori_id}",
            quality: ["1080p", "720p"],
            shikimori: true
        }
    };

    // ================== Кеширование ==================
    const cache = {
        get: (key) => {
            try {
                const data = Lampa.Storage.get(`${PLUGIN_NAME}_${key}`);
                if (data && Date.now() - data.timestamp < CACHE_TTL) return data.value;
                return null;
            } catch (e) {
                console.error('Cache get error:', e);
                return null;
            }
        },
        set: (key, value) => {
            try {
                Lampa.Storage.set(`${PLUGIN_NAME}_${key}`, {
                    value: value,
                    timestamp: Date.now()
                });
            } catch (e) {
                console.error('Cache set error:', e);
            }
        }
    };

    // ================== Основные функции ==================
    function addOnlineButton() {
        console.log('Плагин: Инициализация кнопки');
        
        Lampa.Listener.follow('full', (e) => {
            if (e.type === 'complete' && e.object.activity) {
                console.log('Плагин: Отображение страницы фильма');
                
                // Проверяем, не добавлена ли уже кнопка
                if ($('.view--online_custom').length > 0) return;
                
                const buttonHtml = `
                    <div class="full-start__button selector view--online_custom" data-subtitle="Online">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M10 16.5l6-4.5-6-4.5v9zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                        </svg>
                        <span>Смотреть онлайн</span>
                    </div>
                `;

                const button = $(buttonHtml);
                button.on('hover:enter', () => {
                    console.log('Плагин: Нажата кнопка онлайн просмотра');
                    launchOnlinePlayer(e.data.movie);
                });

                // Добавляем кнопку перед кнопкой play
                const playButton = e.object.activity.render().find('.button--play');
                if (playButton.length) {
                    playButton.before(button);
                    console.log('Плагин: Кнопка добавлена');
                } else {
                    console.error('Плагин: Не найдена кнопка play для вставки');
                }
            }
        });
    }

    // ================== Запуск плеера ==================
    async function launchOnlinePlayer(movie) {
        console.log('Плагин: Запуск онлайн плеера для', movie.title);
        
        try {
            const kpId = movie.kinopoisk_id;
            const imdbId = movie.imdb_id;
            const shikimoriId = movie.shikimori_id || await getShikimoriId(movie.original_title || movie.title);

            console.log('Плагин: IDs:', {kpId, imdbId, shikimoriId});

            if (!kpId && !imdbId && !shikimoriId) {
                throw new Error('Не найден ID для поиска');
            }

            Lampa.Loading.show();
            const sourcesData = await fetchAllSources(kpId, imdbId, shikimoriId);
            
            if (sourcesData.length === 0) {
                throw new Error('Не найдено доступных источников');
            }

            showSourcesModal(sourcesData, movie);
        } catch (error) {
            console.error('Плагин: Ошибка:', error);
            Lampa.Noty.show(`Ошибка: ${error.message}`);
        } finally {
            Lampa.Loading.hide();
        }
    }

    // ================== Получение данных ==================
    async function fetchAllSources(kpId, imdbId, shikimoriId) {
        console.log('Плагин: Поиск источников...');
        const requests = [];

        for (const [key, source] of Object.entries(sources)) {
            const cacheKey = `${key}_${kpId || imdbId || shikimoriId}`;
            const cached = cache.get(cacheKey);
            
            if (cached) {
                console.log('Плагин: Используем кеш для', key);
                requests.push(Promise.resolve(cached));
                continue;
            }

            let url = source.url;
            if (source.shikimori && shikimoriId) {
                url = url.replace('{shikimori_id}', shikimoriId);
            } else if (kpId) {
                url = url.replace('{kp_id}', kpId);
            } else if (imdbId) {
                url = url.replace('{imdb_id}', imdbId);
            } else {
                continue;
            }

            console.log('Плагин: Запрос к', key, url);

            requests.push(
                Lampa.Utils.fetch(url)
                    .then(async res => {
                        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
                        return res.json();
                    })
                    .then(data => {
                        if (!data) throw new Error('Пустой ответ');
                        
                        const result = {
                            source: source.name,
                            data: processSourceData(data, key),
                            key: key
                        };
                        
                        cache.set(cacheKey, result);
                        return result;
                    })
                    .catch(error => {
                        console.error(`Плагин: Ошибка источника ${key}:`, error);
                        return null;
                    })
            );
        }

        const results = await Promise.all(requests);
        return results.filter(Boolean).filter(source => source.data && source.data.length > 0);
    }

    function processSourceData(data, sourceKey) {
        console.log('Плагин: Обработка данных для', sourceKey, data);
        
        try {
            switch (sourceKey) {
                case 'animelib':
                    return data.player ? [{
                        url: data.player.url || data.player.link,
                        quality: '1080p',
                        voice: 'AniLibria'
                    }] : [];
                
                case 'kodik':
                    return data.results ? data.results.map(item => ({
                        url: item.link,
                        quality: item.quality || 'unknown',
                        voice: item.translation?.title || 'unknown'
                    })) : [];
                
                default:
                    return [];
            }
        } catch (e) {
            console.error('Плагин: Ошибка обработки данных:', e);
            return [];
        }
    }

    // ================== Показ модального окна ==================
    function showSourcesModal(sourcesData, movie) {
        console.log('Плагин: Показ модального окна с', sourcesData.length, 'источниками');
        
        let modalHtml = `
            <div class="online-sources-modal">
                <div class="modal__title">Выберите источник</div>
                <div class="modal__subtitle">${movie.title}</div>
                <div class="modal__content">
        `;

        sourcesData.forEach(source => {
            if (!source.data || source.data.length === 0) return;

            modalHtml += `
                <div class="source-group">
                    <h3 class="source-title">${source.source}</h3>
                    <div class="source-options">
            `;

            // Группировка по озвучке
            const voices = source.data.reduce((acc, item) => {
                const voice = item.voice || 'default';
                if (!acc[voice]) acc[voice] = [];
                acc[voice].push(item);
                return acc;
            }, {});

            Object.entries(voices).forEach(([voice, items]) => {
                modalHtml += `
                    <div class="voice-group">
                        <h4 class="voice-title">${voice}</h4>
                        <div class="quality-options">
                `;

                items.forEach(item => {
                    if (!item.url) return;
                    
                    modalHtml += `
                        <div class="quality-option selector" 
                             data-url="${encodeURIComponent(item.url)}" 
                             data-quality="${item.quality || 'unknown'}">
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
            const url = decodeURIComponent($(this).data('url'));
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
        console.log('Плагин: Воспроизведение', url);
        
        if (!url) {
            Lampa.Noty.show('Ошибка: Неверный URL');
            return;
        }

        try {
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
        } catch (e) {
            console.error('Плагин: Ошибка воспроизведения:', e);
            Lampa.Noty.show('Ошибка при запуске плеера');
        }
    }

    // ================== Вспомогательные функции ==================
    async function getShikimoriId(title) {
        if (!title) return null;
        
        const cacheKey = `shikimori_${title}`;
        const cached = cache.get(cacheKey);
        if (cached) return cached;

        try {
            const url = `https://shikimori.one/api/animes?search=${encodeURIComponent(title)}&limit=1`;
            console.log('Плагин: Поиск Shikimori ID:', url);
            
            const response = await Lampa.Utils.fetch(url);
            const data = await response.json();
            
            if (data && data.length > 0 && data[0].id) {
                cache.set(cacheKey, data[0].id);
                return data[0].id;
            }
        } catch (e) {
            console.error('Плагин: Ошибка Shikimori API:', e);
        }
        
        return null;
    }

    // ================== Инициализация ==================
    if (!window.lampa_custom_online_plus) {
        console.log('Плагин: Инициализация');
        window.lampa_custom_online_plus = true;
        
        // Добавляем стили
        const css = `
            .view--online_custom {
                margin-right: 15px;
            }
            .online-sources-modal {
                padding: 20px;
                max-height: 70vh;
                overflow-y: auto;
                color: #fff;
            }
            .source-group {
                margin-bottom: 20px;
                background: rgba(255,255,255,0.1);
                padding: 15px;
                border-radius: 8px;
            }
            .source-title {
                margin: 0 0 10px 0;
                font-size: 1.2em;
                color: #fff;
            }
            .voice-group {
                margin: 15px 0;
            }
            .voice-title {
                margin: 0 0 5px 0;
                font-size: 1em;
                color: rgba(255,255,255,0.8);
            }
            .quality-options {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
            .quality-option {
                padding: 8px 12px;
                background: rgba(255,255,255,0.2);
                border-radius: 4px;
                cursor: pointer;
                transition: background 0.2s;
            }
            .quality-option:hover, .quality-option.focus {
                background: rgba(255,255,255,0.4);
            }
            .modal__title {
                font-size: 1.5em;
                margin-bottom: 10px;
                color: #fff;
            }
            .modal__subtitle {
                font-size: 1.1em;
                margin-bottom: 20px;
                color: rgba(255,255,255,0.8);
            }
        `;
        
        $('head').append(`<style>${css}</style>`);
        addOnlineButton();
    }
})();
