*** Settings ***
Library    SSHLibrary
Library    String

*** Variables ***
${IMAGE_URL}         ghcr.io/platypuschan/organizr-reworked:latest
# The update scenario starts from the last published catalog version;
# test-module-update.sh looks it up in the registry.
${PREVIOUS_IMAGE_URL}    ${EMPTY}
${SCENARIO}          install
${HOST}              organizr.test
${MANUAL_HOST}       organizr-manual.test
${ADMIN_USER}        admin
${ADMIN_PASSWORD}    Nethesis,1234
${module_id}         ${EMPTY}
${web_port}          ${EMPTY}
${AD_DOMAIN}         ad.organizr.test
${AD_USER}           ns8-ci-user
${AD_PASSWORD}       Nethesis,1234
${provider}          ${EMPTY}

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
    ${payload} =    Evaluate    json.dumps({"host": $HOST, "http2https": False, "lets_encrypt": False, "setup_mode": "managed"})    modules=json
    ${output}    ${rc} =    Execute Command    api-cli run module/${module_id}/configure-module --data '${payload}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    configure-module failed: ${output}

Login succeeds
    [Arguments]    ${username}    ${password}
    ${payload} =    Evaluate    json.dumps({"username": $username, "password": $password})    modules=json
    ${login} =    Execute Command    curl -sS -H 'Content-Type: application/json' --data '${payload}' http://127.0.0.1:${web_port}/api/v2/login | jq -r '.response.result'
    ${login} =    Strip String    ${login}
    Should Be Equal    ${login}    success

AD login succeeds
    Login succeeds    ${AD_USER}    ${AD_PASSWORD}

Recovery login succeeds
    ${login} =    Execute Command    api-cli run module/${module_id}/get-setup-credentials | curl -sS -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${web_port}/api/v2/login | jq -r '.response.result'
    ${login} =    Strip String    ${login}
    Should Be Equal    ${login}    success

Organizr auth type is
    [Arguments]    ${expected}
    ${auth} =    Execute Command    runagent -m ${module_id} sh -c '. ./organizr-api.env; curl -fsS -H "Token: $ORGANIZR_API_KEY" http://127.0.0.1:${web_port}/api/v2/config/authType'
    ${value} =    Evaluate    json.loads(r'''${auth}''')['response']['data']    modules=json
    Should Be Equal    ${value}    ${expected}    authType response: ${auth}

AD reconciliation unit state is
    [Arguments]    ${expected}
    # Query separately: systemctl show does not keep the argument order.
    ${active} =    Execute Command    runagent -m ${module_id} systemctl --user show -p ActiveState --value organizr-ad-reconcile.service
    ${result} =    Execute Command    runagent -m ${module_id} systemctl --user show -p Result --value organizr-ad-reconcile.service
    ${state} =    Evaluate    $active.strip() + " " + $result.strip()
    Should Be Equal    ${state}    ${expected}

Login to cluster-admin
    New Page    https://${NODE_ADDR}/cluster-admin/
    Fill Text    text="Username"    ${ADMIN_USER}
    Click    button >> text="Continue"
    Fill Text    text="Password"    ${ADMIN_PASSWORD}
    Click    button >> text="Log in"
    Wait For Elements State    css=#main-content    visible    timeout=10s

*** Test Cases ***
Add and configure module
    ${image} =    Set Variable If    r'${SCENARIO}' == 'update'    ${PREVIOUS_IMAGE_URL}    ${IMAGE_URL}
    ${output}    ${rc} =    Execute Command    add-module ${image} 1
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

Check automated initial setup
    ${rc} =    Execute Command    runagent -m ${module_id} podman exec organizr test -f /config/www/organizr/data/config/config.php
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0
    ${mode} =    Execute Command    runagent -m ${module_id} grep '^ORGANIZR_SETUP_MODE=' organizr-setup.env
    Should Contain    ${mode}    managed
    ${check}    ${rc} =    Execute Command    api-cli run module/${module_id}/get-setup-credentials | jq -e '.username == "ns8-recovery-admin" and (.password | length >= 32)'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    credentials action failed: ${check}
    ${login} =    Execute Command    api-cli run module/${module_id}/get-setup-credentials | curl -sS -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:${web_port}/api/v2/login | jq -r '.response.result'
    ${login} =    Strip String    ${login}
    Should Be Equal    ${login}    success
    ${api_auth} =    Execute Command    runagent -m ${module_id} sh -c '. ./organizr-api.env; curl -fsS -H "Token: $ORGANIZR_API_KEY" http://127.0.0.1:${web_port}/api/v2/config/authType | jq -r ".response.result"'
    ${api_auth} =    Strip String    ${api_auth}
    Should Be Equal    ${api_auth}    success
    ${rc} =    Execute Command    api-cli run module/${module_id}/configure-module --data '{"host":"${HOST}","http2https":false,"lets_encrypt":false,"setup_mode":"manual"}'
    ...    return_rc=True    return_stdout=False
    Should Not Be Equal As Integers    ${rc}    0

Check configuration API
    ${config} =    Execute Command    api-cli run module/${module_id}/get-configuration
    ${config_object} =    Evaluate    json.loads(r'''${config}''')    modules=json
    Should Be Equal    ${config_object}[host]    ${HOST}
    Should Be Equal    ${config_object}[http2https]    ${False}
    Should Be Equal    ${config_object}[lets_encrypt]    ${False}
    Should Be Equal    ${config_object}[setup_mode]    managed
    Should Be Equal    ${config_object}[ad_enabled]    ${False}

Manual setup keeps the Organizr wizard
    IF    r'${SCENARIO}' != 'install'
        Skip    Manual first-run setup is covered by the install scenario
    END
    ${output}    ${rc} =    Execute Command    add-module ${IMAGE_URL} 1
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    add-module failed: ${output}
    &{manual_output} =    Evaluate    ast.literal_eval(r'''${output}''')    modules=ast
    ${manual_id} =    Set Variable    ${manual_output.module_id}
    ${payload} =    Evaluate    json.dumps({"host": $MANUAL_HOST, "http2https": False, "lets_encrypt": False, "setup_mode": "manual"})    modules=json
    ${result}    ${rc} =    Execute Command    api-cli run module/${manual_id}/configure-module --data '${payload}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    configure-module failed: ${result}
    ${rc} =    Execute Command    runagent -m ${manual_id} podman exec organizr test -f /config/www/organizr/data/config/config.php
    ...    return_rc=True    return_stdout=False
    Should Not Be Equal As Integers    ${rc}    0
    ${result}    ${rc} =    Execute Command    api-cli run module/${manual_id}/get-setup-credentials
    ...    return_rc=True
    Should Not Be Equal As Integers    ${rc}    0
    ${rc} =    Execute Command    remove-module --no-preserve ${manual_id}
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0

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

Check AD reconciliation unit
    # Also verifies that an update from the previous version installs the unit.
    ${state} =    Execute Command    runagent -m ${module_id} systemctl --user show -p LoadState --value organizr-ad-reconcile.service
    ${state} =    Strip String    ${state}
    Should Be Equal    ${state}    loaded
    Wait Until Keyword Succeeds    300 seconds    5 seconds    AD reconciliation unit state is    inactive success

Enable AD login through the NS8 LDAP proxy
    IF    r'${SCENARIO}' != 'install'
        Skip    A disposable AD domain is provisioned in the install scenario
    END
    ${provider_output}    ${rc} =    Execute Command    api-cli run add-internal-provider --data '{"image":"samba","node":1}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    Samba provider installation failed: ${provider_output}
    ${provider_id} =    Evaluate    json.loads(r'''${provider_output}''')['module_id']    modules=json
    Set Suite Variable    ${provider}    ${provider_id}
    ${defaults}    ${rc} =    Execute Command    api-cli run module/${provider}/get-defaults --data '{"provision":"new-domain"}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    Samba defaults failed: ${defaults}
    ${ad_ip} =    Evaluate    json.loads(r'''${defaults}''')['ipaddress_list'][0]['ipaddress']    modules=json
    ${provision}    ${rc} =    Execute Command    api-cli run module/${provider}/configure-module --data '{"provision":"new-domain","realm":"${AD_DOMAIN}","nbdomain":"ORGCI","hostname":"dc1","ipaddress":"${ad_ip}","adminuser":"administrator","adminpass":"Nethesis,1234"}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    Samba provisioning failed: ${provision}
    ${user_output}    ${rc} =    Execute Command    api-cli run module/${provider}/add-user --data '{"user":"${AD_USER}","display_name":"NS8 CI User","password":"${AD_PASSWORD}","locked":false,"groups":[],"must_change_password":false}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    AD test user creation failed: ${user_output}
    ${ad_config}    ${rc} =    Execute Command    api-cli run module/${module_id}/configure-module --data '{"host":"${HOST}","http2https":false,"lets_encrypt":false,"setup_mode":"managed","ad_enabled":true,"ad_domain":"${AD_DOMAIN}"}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    Organizr AD setup failed: ${ad_config}
    AD login succeeds
    Recovery login succeeds
    Organizr auth type is    both

AD login survives a restart while the provider is unavailable
    IF    r'${SCENARIO}' != 'install'
        Skip    A disposable AD domain is provisioned in the install scenario
    END
    # Simulates a node reboot where Samba starts after Organizr.
    ${rc} =    Execute Command    runagent -m ${provider} systemctl --user stop samba-dc.service
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0
    ${rc} =    Execute Command    runagent -m ${module_id} systemctl --user restart organizr.service
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0    organizr.service did not start while the provider was unavailable
    Wait until Organizr is reachable
    Wait Until Keyword Succeeds    120 seconds    5 seconds    AD reconciliation unit state is    activating success
    Organizr auth type is    both
    ${rc} =    Execute Command    runagent -m ${provider} systemctl --user start samba-dc.service
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0
    Wait Until Keyword Succeeds    600 seconds    10 seconds    AD reconciliation unit state is    inactive success
    Organizr auth type is    both
    Wait Until Keyword Succeeds    120 seconds    10 seconds    AD login succeeds

Restore AD-enabled instance from backup
    IF    r'${SCENARIO}' != 'install'
        Skip    A disposable AD domain is provisioned in the install scenario
    END
    ${endpoint} =    Execute Command    api-cli run list-cluster-backup-endpoints | jq -r '.endpoints[0].url'
    Should Start With    ${endpoint}    webdav:
    ${payload} =    Evaluate    json.dumps({"name": "organizr-ci", "provider": "cluster", "url": $endpoint, "password": "", "parameters": {}})    modules=json
    ${repository}    ${rc} =    Execute Command    api-cli run add-backup-repository --data '${payload}' | jq -r .id
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    backup repository creation failed: ${repository}
    ${payload} =    Evaluate    json.dumps({"name": "organizr-ci", "repository": $repository, "schedule": "daily", "retention": 1, "instances": [$module_id], "enabled": True})    modules=json
    ${backup_id}    ${rc} =    Execute Command    api-cli run add-backup --data '${payload}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    backup creation failed: ${backup_id}
    ${output}    ${rc} =    Execute Command    api-cli run run-backup --data '{"id":${backup_id}}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    backup failed: ${output}
    ${uuid} =    Execute Command    runagent -m ${module_id} printenv MODULE_UUID
    ${uuid} =    Strip String    ${uuid}
    ${rc} =    Execute Command    remove-module --no-preserve ${module_id}
    ...    return_rc=True    return_stdout=False
    Should Be Equal As Integers    ${rc}    0
    # restore-module runs configure-module before organizr.service has started.
    ${payload} =    Evaluate    json.dumps({"repository": $repository, "path": "organizr-reworked/" + $uuid, "snapshot": "", "node": 1})    modules=json
    ${output}    ${rc} =    Execute Command    api-cli run restore-module --data '${payload}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    restore failed: ${output}
    ${restored} =    Evaluate    json.loads(r'''${output}''')['module_id']    modules=json
    Set Suite Variable    ${module_id}    ${restored}
    Read allocated web port
    Wait until Organizr is reachable
    ${config} =    Execute Command    api-cli run module/${module_id}/get-configuration
    ${config_object} =    Evaluate    json.loads(r'''${config}''')    modules=json
    Should Be Equal    ${config_object}[setup_mode]    managed
    Should Be Equal    ${config_object}[ad_enabled]    ${True}
    Organizr auth type is    both
    AD login succeeds
    Recovery login succeeds

Disable AD login and remove the test domain
    IF    r'${SCENARIO}' != 'install'
        Skip    A disposable AD domain is provisioned in the install scenario
    END
    ${disabled}    ${rc} =    Execute Command    api-cli run module/${module_id}/configure-module --data '{"host":"${HOST}","http2https":false,"lets_encrypt":false,"setup_mode":"managed","ad_enabled":false}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    Organizr AD disable failed: ${disabled}
    Organizr auth type is    internal
    Recovery login succeeds
    ${removed}    ${rc} =    Execute Command    api-cli run remove-internal-domain --data '{"domain":"${AD_DOMAIN}"}'
    ...    return_rc=True
    Should Be Equal As Integers    ${rc}    0    AD test domain removal failed: ${removed}

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
