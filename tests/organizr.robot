*** Settings ***
Library    SSHLibrary
Library    String

*** Variables ***
${IMAGE_URL}         ghcr.io/platypuschan/organizr-reworked:latest
${SCENARIO}          install
${HOST}              organizr.test
${ADMIN_USER}        admin
${ADMIN_PASSWORD}    Nethesis,1234
${module_id}         ${EMPTY}
${web_port}          ${EMPTY}

*** Keywords ***
Organizr web page is reachable
    ${rc} =    Execute Command    curl -fsS --max-time 10 -o /dev/null http://127.0.0.1:${web_port}/
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0

Wait until Organizr is reachable
    Wait Until Keyword Succeeds    300 seconds    5 seconds    Organizr web page is reachable

Read allocated web port
    ${port} =    Execute Command    runagent -m ${module_id} printenv TCP_PORT
    ${port} =    Strip String    ${port}
    Should Match Regexp    ${port}    ^[0-9]+$
    Set Suite Variable    ${web_port}    ${port}

Configure module
    ${payload} =    Evaluate    json.dumps({"host": $HOST, "http2https": False, "lets_encrypt": False})    modules=json
    ${output}    ${rc} =    Execute Command    api-cli run module/${module_id}/configure-module --data '${payload}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    configure-module failed: ${output}

Login to cluster-admin
    New Page    https://${NODE_ADDR}/cluster-admin/
    Fill Text    text="Username"    ${ADMIN_USER}
    Click    button >> text="Continue"
    Fill Text    text="Password"    ${ADMIN_PASSWORD}
    Click    button >> text="Log in"
    Wait For Elements State    css=#main-content    visible    timeout=10s

*** Test Cases ***
Add and configure module
    ${output}    ${rc} =    Execute Command    add-module ${IMAGE_URL} 1
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    add-module failed: ${output}
    &{output} =    Evaluate    ast.literal_eval(r'''${output}''')    modules=ast
    Set Suite Variable    ${module_id}    ${output.module_id}
    Configure module
    Read allocated web port
    Wait until Organizr is reachable

Check application files and managed environment
    ${rc} =    Execute Command    runagent -m ${module_id} podman exec organizr test -f /config/www/organizr/index.php
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0
    ${branch} =    Execute Command    runagent -m ${module_id} podman exec organizr printenv branch
    ${branch} =    Strip String    ${branch}
    Should Be Equal    ${branch}    v2-master
    ${puid} =    Execute Command    runagent -m ${module_id} podman exec organizr printenv PUID
    ${puid} =    Strip String    ${puid}
    Should Be Equal    ${puid}    1000

Check configuration API
    ${config} =    Execute Command    api-cli run module/${module_id}/get-configuration
    ${config_object} =    Evaluate    json.loads(r'''${config}''')    modules=json
    Should Be Equal    ${config_object}[host]    ${HOST}
    Should Be Equal    ${config_object}[http2https]    ${False}
    Should Be Equal    ${config_object}[lets_encrypt]    ${False}

Check persistent volume across restart or update
    ${rc} =    Execute Command    runagent -m ${module_id} podman exec organizr sh -c 'printf ns8-persist > /config/ns8-persistence-test'
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0
    IF    r'${SCENARIO}' == 'update'
        ${output}    ${rc} =    Execute Command    api-cli run update-module --data '{"force":true,"module_url":"${IMAGE_URL}","instances":["${module_id}"]}'
        ...    return_rc=True
        Should Be Equal As Integers    ${rc}    0    update-module failed: ${output}
    ELSE
        ${rc} =    Execute Command    runagent -m ${module_id} systemctl --user restart organizr.service
        ...    return_rc=True    return_stdout=False
        Should Be Equal As Integers    ${rc}    0
    END
    Wait until Organizr is reachable
    ${marker} =    Execute Command    runagent -m ${module_id} podman exec organizr cat /config/ns8-persistence-test
    ${marker} =    Strip String    ${marker}
    Should Be Equal    ${marker}    ns8-persist

Check public HTTP route
    ${rc} =    Execute Command    curl -fsS --max-time 15 --resolve ${HOST}:80:127.0.0.1 -o /dev/null http://${HOST}/
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0

Take UI screenshots
    [Tags]    ui
    Import Library    Browser
    New Browser    chromium    headless=True
    New Context    ignoreHTTPSErrors=True
    Login to cluster-admin
    Go To    https://${NODE_ADDR}/cluster-admin/#/apps/${module_id}
    Wait For Elements State    iframe >>> h2 >> text="Status"    visible    timeout=20s
    Sleep    3s
    Take Screenshot    filename=${OUTPUT DIR}/browser/screenshot/1._Status.png
    Go To    https://${NODE_ADDR}/cluster-admin/#/apps/${module_id}?page=settings
    Wait For Elements State    iframe >>> h2 >> text="Settings"    visible    timeout=20s
    Sleep    3s
    Take Screenshot    filename=${OUTPUT DIR}/browser/screenshot/2._Settings.png
    Close Browser

Remove module
    ${rc} =    Execute Command    remove-module --no-preserve ${module_id}
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0
