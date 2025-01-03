const form_settings_path = 'views/form_settings2.html';

let BASE_URL = "";
let newVersion = false;
let ACTION_LOG = `date;type;event;task_action_type;task_id;url\r\n`;
let DEBUG_LOG = '';
let SEND_MESSAGE_ERROR_COUNT = 0;
let LAST_BACKGROUND_MODE = undefined;
let TIMEOUT_BACKGROUND_WORK_LABELS = undefined;

Sentry.init({
  dsn: "https://5e223b606a084d27bbf7dadef69cc012@o4505430185082880.ingest.sentry.io/4505430188818432",
});

// +++ БЛОК ФУНКЦИЙ +++
/**
 * @param el
 * @param value
 * @returns {{param, value, network}}
 */
function createSettingParam(el, value = undefined) {
  if (value === undefined) {
    value = getInputValue(el);
  }

  return [
    el.data("network"),
    el.data("param"),
    value
  ];
}

/**
 * @param el
 * @returns {string|boolean}
 */
function getInputValue(el) {
  switch (el.prop("type")) {
    case 'checkbox':
      return el.prop("checked");
    default:
      return el.val();
  }
}

/**
 * Установка значения в поле
 * @param el
 * @param value
 */
function setInputValue(el, value) {
  switch (el.prop("type")) {
    case 'checkbox':
      el.prop("checked", value);
      if (el.hasClass('task-type-control')) {
        toggleTaskTypeControl(el);
      }
      if (el.hasClass('soc-net-control')) {
        toggleSocNetControl(el);
      }
      break;
    default:
      el.val(value);
      break;
  }
}

/**
 * Переключение чекбокса для соцсетей
 * @param el
 */
function toggleSocNetControl(el) {
  let enable = el.prop('checked');
  let socNet = el.data('soc-net');
  if (enable) {
    $(`#soc-net-${socNet}`).addClass('in');
  } else {
    $(`#soc-net-${socNet}`).removeClass('in');
  }

  toggleStartButtonDisable();
}

/**
 * Переключение чекбокса для типов заданий соцсетей
 * @param el
 */
function toggleTaskTypeControl(el) {
  let enable = el.prop('checked');
  let network = el.data('network');
  let task = el.data('task');
  $(`.task-type-${network}-${task}`).prop('disabled', !enable);
  toggleStartButtonDisable();
}

/**
 * Запуск и остановка работы
 * @param workEnable
 */
function toggleWork(workEnable) {
  chrome.runtime.sendMessage({type: 'work_enable', value: workEnable});
}

/**
 * Установка элементов в зависимости от текущего состояния работы
 * @param workMode
 * @param showSetting
 */
function toggleWorkElements(workMode, showSetting = true) {
  $(".pause-work").hide();
  $(".stopping-work").hide();
  $(".stop-work").hide();
  $(".start-work").hide();
  $(".bot-liker-main-nav-elements").removeClass('active');
  $("#bot-liker-home-tab-status-not-work").show();
  $("#bot-liker-home-tab-status-work").hide();

  let controlDisabled = false;

  switch (workMode) {
    case 'work_started':
      showErrorOrInfo('');
      $("#bot-liker-home-tab-status-not-work").hide();
      $("#bot-liker-home-tab-status-work").show();
      $(".stop-work").show();
      $(".bot-liker-main-nav-stat").addClass('active');
      $("#botHome").removeClass('active');
      $("#bot-liker-link-from-home").attr('href', '#botStat');
      $("#bot-liker-link-from-home").attr('aria-controls', 'botStat');
      controlDisabled = true;
      break;
    case 'work_stopped':
      if (showSetting) {
        // $(".bot-liker-main-nav-setting").addClass('active');
      }
      else {
        $(".bot-liker-main-nav-stat").addClass('active');
        $("#botHome").removeClass('active');
      }
      $(".start-work").show();
      controlDisabled = false;
      break;
    case 'work_stopping':
      $(".stopping-work").show();
      $(".bot-liker-main-nav-stat").addClass('active');
      $("#botHome").removeClass('active');
      $("#bot-liker-link-from-home").attr('href', '#botStat');
      $("#bot-liker-link-from-home").attr('aria-controls', 'botStat');
      controlDisabled = true;
      break;
    case 'work_paused':
      $(".pause-work").show();
      $(".stop-work").show();
      $(".bot-liker-main-nav-stat").addClass('active');
      $("#botHome").removeClass('active');
      $("#bot-liker-link-from-home").attr('href', '#botStat');
      $("#bot-liker-link-from-home").attr('aria-controls', 'botStat');
      controlDisabled = true;
      break;
  }

  // $(".stop-work").show();
  // $(".bot-liker-main-nav-stat").addClass('active');

  $(`.settings-control`).prop('disabled', controlDisabled);
  $(`.settings-label`).prop('disabled', controlDisabled);
  $(`.wipe-settings`).prop('disabled', controlDisabled);

  let navSettingEl = $("#bot-liker-main-nav-setting");
  if (controlDisabled) {
    navSettingEl.addClass('disabled');
    $("#bot-liker-main-nav-setting").children()[0].dataset.toggle = '';
  }
  else {
    $(".task-type-control").each(function(){
      toggleTaskTypeControl($(this));
    })

    navSettingEl.removeClass('disabled');
    $("#bot-liker-main-nav-setting").children()[0].dataset.toggle = 'tab';
  }
}

/**
 * Обновление статистики, счетчиков и пр
 * @returns {Promise<void>}
 */
async function refreshStat() {
  try {
    let {Settings} = await import(`../common/settings.js`);
    let settings = await Settings.getSettings();
    let {Lang} = await import(`../common/lang.js`);
    let lang = await Lang.getLang();
    let statElementTemplate = $("#bot-liker-stat-template");
    let workActive = await settings.common.work_enable;
    let currentNetworkTask = await settings.common.current_task;

    // Обновление статуса работы в бэкграунде
    const bm = await settings.common.backgroundMode;
    if (LAST_BACKGROUND_MODE !== bm) {
      LAST_BACKGROUND_MODE = bm;
      const backgroundModeSpan = bm ? `<span class="badge badge-success badge-circle">B</span>` : '';
      $('#ext-background-mode').html(backgroundModeSpan);
    }

    // Обновление счетчиков и статусов
    let hasActiveTask = false;
    let hasTask = false;
    for (let paramNetwork in settings.platforms) {
      let platformEnable = await settings.common[`${paramNetwork}_enable`];
      let generalTaskError = 0;
      let generalTaskSuccess = 0;
      let statDivEl = $(`#bot-liker-counters-stat-${paramNetwork}`);

      for (let paramTaskType in settings[paramNetwork].tasks) {
        // получаем ид элементов и создаем в разметке. Далее скрываем или показываем
        let currentTaskIdPart = `${paramNetwork}-${paramTaskType}`;
        let currentTaskStatElId = `task-stat-${paramNetwork}-${paramTaskType}`;
        let existCurrentTaskStatEl = true;
        let currentTaskStatEl = $("#"+currentTaskStatElId);
        if (currentTaskStatEl.length === 0) {
          // если ранее не было создано html элемента с типом задач, то создаем из шаблона
          existCurrentTaskStatEl = false;
          currentTaskStatEl = statElementTemplate.clone();
          currentTaskStatEl.attr('id', currentTaskStatElId);
          currentTaskStatEl.hide();
          // если впервые создали элемент, нужно его домабвть в разметку
          statDivEl.append(currentTaskStatEl);
        }

        let currentTask = settings[paramNetwork].tasks[paramTaskType];
        if (platformEnable === false || false === await currentTask.enable) {
          // если выключено, скрываем задачу из статистики
          currentTaskStatEl.hide();
          continue;
        }
        else {
          currentTaskStatEl.show();
        }

        hasTask = true;
        let successCounter = parseInt(await currentTask.success_counter);
        let errorCounter = parseInt(await currentTask.error_counter);
        let errorCounterInARow = parseInt(await currentTask.error_counter_in_a_row);
        let limit = parseInt(await currentTask.limit);
        let counter = parseInt(await currentTask.counter);

        generalTaskError+= errorCounter;
        generalTaskSuccess+= successCounter;

        let statusLabel = lang.currentLang.unknown_status;
        let statusTitle = lang.currentLang[`task_title_${paramTaskType}`];
        let statusDesc = '';
        // Высчитываем состояние для каждомо типа задачи
        if (counter >= limit && errorCounterInARow > 0) { // 3 ошибки подряд
          statusLabel = lang.strtr(lang.currentLang.task_status_errors_in_a_row, {'{errors}' : errorCounterInARow});
          statusDesc = '<i class="fa-times-circle fal text-danger"></i>';
        }
        else if (counter >= limit) { // дневной лимит выполнен
          statusLabel = lang.currentLang.task_status_daily_limit_completed;
          statusDesc = '<i class="fa-check-circle fal text-success"></i>';
        } else if (currentNetworkTask === currentTaskIdPart) { // текущая задача
          hasActiveTask = true;
          statusLabel = lang.currentLang.layout_in_progress + '...';
          statusDesc = '<i class="fa-play-circle far text-primary"></i>';
        } else { // в ожидании
          hasActiveTask = true;
          statusLabel = lang.currentLang.layout_awaiting_launch;
          statusDesc = '<i class="fa-pause-circle fal text-muted"></i>';
        } 

        currentTaskStatEl.find('.stat-task-title').html(statusTitle);
        currentTaskStatEl.find('.stat-task-status').html(statusLabel);
        currentTaskStatEl.find('.stat-task-status-desc').html(statusDesc);
        currentTaskStatEl.find('.stat-task-success-count').html(successCounter);
        currentTaskStatEl.find('.stat-task-error-count').html(errorCounter);
      }

      $(`#bot-liker-stat-task-general-success-${paramNetwork}`).html(generalTaskSuccess);
      $(`#bot-liker-stat-task-general-error-${paramNetwork}`).html(generalTaskError);
    }

    // Убираем или добавляем сообщение о лимитах
    if (hasTask) {
      if (hasActiveTask) {
        showErrorOrInfo('', 'error-limit');
      }
      else {
        showErrorOrInfo(lang.currentLang.limit_exec_error_text, 'error-limit');
      }
    }
    else {
      showErrorOrInfo('', 'error-limit');
    }

    // Установка активной задачи
    if (workActive && currentNetworkTask !== undefined && currentNetworkTask !== null) {
      $(`#bot-liker-stat-${currentNetworkTask}-status`)
        .html(lang.currentLang.layout_in_progress)
        .prop('class', 'text-success');
    }

    // Установка общего счетчика
    const timeFormat = (sec) => {
      function num(val) {
        val = Math.floor(val);
        return val < 10 ? '0' + val : val;
      }

      let hours = sec / 3600 % 24
        , minutes = sec / 60 % 60
        , seconds = sec % 60
      ;

      return num(hours) + ":" + num(minutes) + ":" + num(seconds);
    };

    let workSeconds = await settings.common.work_seconds;
    $("#bot-liker-general-time").html(timeFormat(workSeconds));

    // Установка счетчика паузы
    if (true === await settings.common.work_pause) {
      let pauseSeconds = await settings.common.pause_seconds;
      pauseSeconds = pauseSeconds < 0 ? 0 : pauseSeconds;
      $("#bot-liker-pause-time").show();
      $("#bot-liker-general-time-container").hide();
      $("#bot-liker-pause-time").html(timeFormat(pauseSeconds));
    }
    else {
      $("#bot-liker-pause-time").hide();
      $("#bot-liker-general-time-container").show();
    }

    // Обновление логов
    let logTableBody = "";
    let logData = await settings.common.logData;
    ACTION_LOG = `date;type;event;task_action_type;task_id;url\r\n`;
    logData.forEach(function(item, i, arr) {
      let typeIcon = '';
      if (item.event === 'start_action') {
        typeIcon = `<i class="fa-fw fa-lg fa-play-circle fal text-primary"></i>`;
      } else if (item.event === 'task_result_success' || item.event === 'task_recheck_exchange') {
        typeIcon = `<i class="fa-fw fa-lg fa-eye fal text-grad-4"></i>`;
      }
      else if (item.event === 'work_start' || item.event === 'work_stop') {
        typeIcon = `<i class="fa-fw fa-lg fa-puzzle-piece fal text-success"></i>`;
      }
      else {
        typeIcon = item.type === 'info'
          ? `<i class="fa-fw fa-lg fa-check fal text-success"></i>`
          : `<i class="fa-fw fa-lg fa-times-circle fal text-danger"></i>`;
      }
      let event = lang.currentLang[`log_event_${item.event}`]
      let taskActionType = item.task_action_type !== undefined
        ? `<strong>${lang.currentLang[`task_action_type_${item.task_action_type}`]}</strong>` : '';
      let taskId = item.task_id !== undefined ?  ` – ${item.task_id}` : '';
      let networkIcon = item.network === undefined ? '' :
        `<i class="fab fa-${item.network}  text-${item.network} fa-lg"></i> `;
      let taskUrl = item.url !== undefined ?
        `<a href="${item.url}" style="max-width: 280px;" class="btn-block text-overflow" target="_blank">
          ${item.url}
        </a>` : '';
      let message = `${item.date};${item.type};${item.event};${item.task_action_type};${item.task_id};${item.url}\r\n`;
      ACTION_LOG += message;
      logTableBody+= `<tr>
                        <td class="task-try-date" style="text-align: left; width: 120px;">${item.date}</td>
                        <td style="min-width: 200px;">
                          <div class="media media_table media_default media_xs">
                            <div class="media-avatar media-left media-middle text-center">
                                ${typeIcon}
                            </div>
                            <div class="media-body media-middle full-width">
                                <div class="media-content">
                                    <div class="media-info">
                                        <h3 class="media-info-name" style="line-height: 1.2; white-space: normal;">${event}</h3>
                                    </div>
                                </div>
                            </div>
                          </div>
                        </td>`;
      if (taskId !== undefined) {
        logTableBody+= `<td>
                            <div class="text-nowrap">
                                ${networkIcon}${taskActionType}${taskId}
                            </div>
                            ${taskUrl}
                        </td>`;
      } else {
        logTableBody+= `<td></td>`;
      }
      logTableBody+= '</tr>';
    });
    if (logTableBody !== "") {
      $("#bot-liker-log").html(`${logTableBody}`);
    }

    let debugLog = await settings.common.debugLog;
    let debugLogString = ''
    debugLog.forEach(function(item, i, arr) {
      debugLogString+= `${item}\r\n`;
    });
    // DEBUG_LOG = btoa(unescape(encodeURIComponent(debugLogString)));
    DEBUG_LOG = debugLogString;
  }
  catch (e) {}
}

/**
 * Переключение видимости главного блока
 * @param value
 */
async function toggleMainBodyVisible(value) {

  if (value == true) {
    value = await injectCode(chrome.runtime.getURL('js/common/injects/getClickerIsVisible.js')) === "1";
  }

  if (value) {
    $("#clicker").addClass('in');
  } else {
    $("#clicker").removeClass('in');
  }
}

/**
 * Проверка версии
 * @returns {Promise<void>}
 */
async function checkVersion() {
  let { ExtApi } = await import(`../common/ext_api.js`);
  newVersion = await ExtApi.checkVersion();
  if (newVersion !== false) {
    let {Lang} = await import(`../common/lang.js`);
    let lang = await Lang.getLang();
    $(".new-version-number").html(newVersion.version);
    showErrorOrInfo(lang.strtr(lang.currentLang.layout_new_version, {'{link}': newVersion.download_link}), 'info');
    showErrorOrInfo(lang.currentLang.need_update, 'error');
    toggleStartButtonDisable();
    $(".bot-liker-main-nav-elements").removeClass('active');
    // $(".bot-liker-main-nav-stat").addClass('active');
    $("#bot-liker-no-need-update").hide();
    $("#bot-liker-need-update").show();
    $(".bot-liker-row-open-settings").hide();
    $(".bot-liker-new-version-link").attr('href', newVersion.download_link);
  }
}

/**
 * Валидация
 * @param el
 * @returns {boolean}
 */
function validate(el) {
  const isNumeric = (str) => {
    return !isNaN(parseFloat(str)) && isFinite(str)
  }
  const getComparisonValue = (param, cond, condValue) => {
    let lessParam = el.data(param);
    if (lessParam) {
      let lessEl = $(`[data-param="${lessParam}"]`);
      if (lessEl.length) {
        let value = parseInt(lessEl.val());
        let result;
        switch (cond) {
          case '>=':
            result = condValue >= value;
            break;
          case '<=':
            result = condValue <= value;
            break;
          case '>':
            result = condValue > value;
            break;
          case '<':
            result = condValue < value;
            break;
          default:
            return result = value;
        }

        return result;
      }
    }

    return cond !== undefined ? true : undefined;
  }

  if (!el.data('validate')) {
    return true;
  }

  let validate = false;

  if (el.data('validate-type') === 'number') {
    let value = getInputValue(el);
    if (value == undefined || value == '') {
      return el.data('validate-allow-undefined') == 1;
    }
    let min = parseInt(el.data('validate-min'));
    let max = parseInt(el.data('validate-max'));
    validate =
      (isNumeric(value) && value >= min && value <= max)
        && getComparisonValue('validate-less-than', '<', value)
        && getComparisonValue('validate-more-than', '>', value);
  }

  return validate;
}

/**
 * Проверка платформы
 * @returns {boolean}
 */
function checkIsMobile() {
  let ua = navigator.userAgent;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua);
}

/**
 * Перевод главного лейаута
 * @param layout
 * @returns {Promise<{val: *, key: string, token: string}>}
 */
async function translateLayout(layout) {
  let { Settings } = await import(`../common/settings.js`);
  let settings = await Settings.getSettings();

  settings.common.language = /\/en\//.test(location.href) ? 'en' : 'ru';

  let {Lang} = await import(`../common/lang.js`);
  let lang = await Lang.getLang();

  let transaltes = {};
  for (let t in lang.currentLang) {
    transaltes[`{{${t}}}`] = lang.currentLang[t];
  }

  return lang.strtr(layout, transaltes);
}

/**
 * Обработчик первого открытия
 * @returns {Promise<*>}
 */
async function firstOpenSendEvent(currentVersion) {
  try {
    // Событие в метрику об инсталле
    await injectCode(chrome.runtime.getURL('js/common/injects/sendYaEventReachGoal.js'), 'extension_installed');

    // Событие на сервер об инсталле
    let { ExtApi } = await import(`../common/ext_api.js`);
    return await ExtApi.event([`event_type=installed`]);
  } catch (e) {
    return false;
  }
}

/**
 * Переключение доступности кнопки старт работы
 */
function toggleStartButtonDisable() {
  $(".start-work").prop('disabled',
    $(".task-type-control:checkbox:checked").length === 0
    || $(".soc-net-control:checkbox:checked").length === 0
    || newVersion !== false
  );
}

/**
 * Управление полями информации и ошибок
 * @param value
 * @param type
 */
function showErrorOrInfo(value, type = 'error') {
  if (value === '') {
    $(`#bot-liker-${type}`).hide();
  }
  else {
    $(`#bot-liker-${type}`).show();
  }
  $(`#bot-liker-${type}-text`).html(value);
}

async function extraHandleControlElementsChange(el) {
  if (el.data('param') === 'tg_chat_id') {
    let { ExtApi } = await import(`../common/ext_api.js`);
    await ExtApi.settings([`telegram_chat_id=${el.val()}`]);
  }
}

async function loadDocs() {
  let { ExtApi } = await import(`../common/ext_api.js`);
  let result = await ExtApi.getDocs();
  $('#bot-liker-docs-text').html(result);
}

async function keepAlive() {
  try {
    chrome.runtime.sendMessage({type: 'keep_alive'}, function (response) {
      console.log('keep alive ok')
    });
    SEND_MESSAGE_ERROR_COUNT = 0;
  } catch (e) {
    SEND_MESSAGE_ERROR_COUNT++;
  }

  if (SEND_MESSAGE_ERROR_COUNT > 5) {
    // let {debugError} = await import(`../common/debug.js`);
    // await debugError('form_settings.keepAlive', 'reload_getlike_tab', 'Перезагрузка из-за потери связи с воркером'); // Нельзя оставить лог, т.к. связь с воркером потеряна и весь контекст хранилища потерян
    document.location.reload();
  }
}

/**
 * Обработчик старта проверок в фоне. Переключает иконки.
 * @returns {Promise<void>}
 */
async function startBackgroundWorkHandler(openModal) {
  $("#bot-liker-background-work-disabled").hide();
  $("#bot-liker-background-work-enabled").show();
  if (openModal) {
    injectCode(chrome.runtime.getURL('js/common/injects/openModalBackgroundWork.js'));
  }
  clearTimeout(TIMEOUT_BACKGROUND_WORK_LABELS);
  TIMEOUT_BACKGROUND_WORK_LABELS = setTimeout(() => {
    $("#bot-liker-background-work-disabled").show();
    $("#bot-liker-background-work-enabled").hide();
    if (openModal) {
      injectCode(chrome.runtime.getURL('js/common/injects/closeModalBackgroundWork.js'));
    }
  }, 15 * 1000);
}
// --- БЛОК ФУНКЦИЙ ---


// +++ ГЛАВНЫЙ АСИНХРОННЫЙ МЕТОД +++
async function init() {
  let { Settings } = await import(`../common/settings.js`);
  let settings = await Settings.getSettings();

  toggleMainBodyVisible(settings.checkShowMainBody(document.location.href));

  // Установка верного урла
  BASE_URL = await settings.getBaseUrl();

  if (true === await settings.common.first_open) {
    settings.setDefaultTasksSettings();
    settings.common.first_open = false;
  }
  if (false === await settings.common.event_sent_first_open) {
    if (await firstOpenSendEvent(await settings.common.version)) {
      settings.common.event_sent_first_open = true;
      document.location.reload();
    }
  }

  let settingsControlElements = $(".settings-control");

  $(".current-version-number").html(await settings.common.version);
  $("#bot-liker-need-update").hide();

  $("#bot-liker-docs-link").on('click', async function () {
    await loadDocs();
    $(".bot-liker-main-nav-setting").removeClass('active');
    $(".bot-liker-main-nav-stat").removeClass('active');
  });

  // Установка всех настроек в поля
  $.when(settingsControlElements.each(async function(){
    let el = $(this);
    let value = await settings.load(...createSettingParam(el))
    setInputValue(el, value);
  }))
    .then(async function () {
    // Установка всех полей в зависимости от состояния работы
    let workMode;
    if (await settings.common.work_enable) {
      if (await settings.common.work_pause) {
        workMode = 'work_paused';
      } else {
        workMode = 'work_started'
      }
    }
    else {
      if (false === await settings.common.work_fully_stop) {
        workMode = 'work_stopping';
      }
      else {
        workMode = 'work_stopped';
      }
    }
    toggleWorkElements(workMode);
  });

  // Установка события на изменение настроек
  settingsControlElements.on('change', async function (event) {
    try {
      let el = $(this);
      if (validate(el)) {
        extraHandleControlElementsChange(el);
        await settings.save(...createSettingParam(el));
      }
      else {
        event.preventDefault();
        let value = await settings.load(...createSettingParam(el))
        setInputValue(el, value);
        return false;
      }
    } catch (e) {
      document.location.reload();
    }
  });

  // Установка события на изменение типа задачи
  $(".task-type-control").on('change', function (elem) {
    toggleTaskTypeControl($(this));
  });

  // Установка события на вклюение оцсети
  $(".soc-net-control").on('change', function (elem) {
    toggleSocNetControl($(this));
  });

  // Обработка кнопок Запустить и Остановить
  $(".start-work").on('click', async function (elem) {
    try {
      if (false === await settings.common.work_enable) {
        if ($(".task-type-control:checkbox:checked").length > 0) {
          settings.common.work_enable = true;
          settings.common.work_fully_stop = false;
          toggleWork(true);
          toggleWorkElements('work_started');
        }
      }
    } catch (e) {
      document.location.reload();
    }
  });
  $(".stop-work").on('click', async function (elem) {
    try {
      settings.common.work_enable = false;
      toggleWork(false);
      toggleWorkElements('work_stopping');
    } catch (e) {
      document.location.reload();
    }
  });

  // Обработка кнопок по сбросу настроек и статы
  $(".wipe-counters").on('click', async function (elem) {
    try {
      settings.common.work_seconds = 0;
      settings.wipeAllCounters();
      showErrorOrInfo('', 'error-limit');
      refreshStat();
    } catch (e) {
      document.location.reload();
    }
  });
  $(".wipe-settings").on('click', async function (elem) {
    try {
      settings.setDefaultTasksSettings();
      document.location.reload();
    } catch (e) {
      document.location.reload();
    }
  });

  // Обновление статы
  await refreshStat();

  // Проверка версии
  await checkVersion();

  // Проверка мобайл
  let is_mobile = await settings.common.is_mobile;
  if (is_mobile === undefined) {
    settings.common.is_mobile = checkIsMobile() ? 1 : 0;
  }


  setInterval(() => refreshStat(), 1000);

  setInterval(() => keepAlive(), 3000);

  $("#download-logs").on('click', async function () {
    const link = document.createElement("a");
    const file = new Blob([`${ACTION_LOG}\r\n\r\n\r\n${DEBUG_LOG}`], { type: 'text/plain' });
    link.href = URL.createObjectURL(file);
    link.download = "action_logs.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  })
}
// --- ГЛАВНЫЙ АСИНХРОННЫЙ МЕТОД ---


// +++ ЗАГРУЗКА HTML и ЗАПУСК ГЛАВНОГО МЕТОДА +++
$.get(chrome.runtime.getURL(form_settings_path)).done(async function(data) {
  const language = /\/en\//.test(location.href) ? 'en' : 'ru';
  $.get(chrome.runtime.getURL(`views/form_settings_page_checking_${language}.html`)).done(async function(dataPageChecking) {
    let translatedLayout = await translateLayout(data);
    let translatedLayoutPageChecking = await translateLayout(dataPageChecking);
    $(".page-content").eq(0).prepend(translatedLayout);
    $("#botAdvancedСhecking").html(translatedLayoutPageChecking);
    await init();
  })
});
// --- ЗАГРУЗКА HTML и ЗАПУСК ГЛАВНОГО МЕТОДА ---


// +++ СЛУШАТЕЛИ +++
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  let value = request.value;
  let type = request.type;
  switch (type) {
    case 'refresh_page':
      document.location.reload();
      break;
    case 'refresh_stat':
      refreshStat();
      break;
    case 'stop_work':
      toggleWorkElements('work_stopped', false);
      refreshStat();
      break;
    case 'pause_work':
      toggleWorkElements('work_paused');
      refreshStat();
      break;
    case 'resume_work':
      toggleWorkElements('work_started');
      refreshStat();
      break;
    case 'error':
      showErrorOrInfo(value, 'error');
      break;
    case 'error_limit':
      showErrorOrInfo(value, 'error-limit');
      break;
    case 'info':
      showErrorOrInfo(value, 'info');
      break;
    case 'clear_error':
      showErrorOrInfo('', 'error');
      break;
    case 'clear_error_limit':
      showErrorOrInfo('', 'error-limit');
      break;
    case 'set_visible_form':
      toggleMainBodyVisible(value);
      break;
    case 'check_new_version':
      checkVersion();
      break;
    case 'start_background_work':
      startBackgroundWorkHandler(value);
      break;
  }
  sendResponse();
});
// --- СЛУШАТЕЛИ ---