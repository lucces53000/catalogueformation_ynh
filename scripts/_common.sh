#!/bin/bash

source /usr/share/yunohost/helpers

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fcm_service_account_file=""

configure_package() {
    mkdir -p "$install_dir/src" "$data_dir" "/var/log/$app"
    if [ -d "$app_root/src" ]; then
        cp -a "$app_root/src/." "$install_dir/src/"
    elif [ -d "$YNH_APP_SRC_DIR/src" ]; then
        cp -a "$YNH_APP_SRC_DIR/src/." "$install_dir/src/"
    else
        ynh_die "Sources frontales introuvables dans le paquet."
    fi
    mkdir -p "$install_dir/server"
    cp -a "$app_root/server/." "$install_dir/server/"
    cp "$app_root/package.json" "$install_dir/package.json"
    chown -R "$app:$app" "$install_dir" "$data_dir" "/var/log/$app"
    chmod 750 "$data_dir"
<<<<<<<<< Temporary merge branch 1
    chmod 750 "$data_dir/src" "$install_dir/server"
=========
    chmod 750 "$install_dir/src" "$install_dir/server"
>>>>>>>>> Temporary merge branch 2
    if [ -n "${fcm_service_account:-}" ]; then
        if [ ! -f "$fcm_service_account" ]; then
            ynh_die "Le fichier du compte de service FCM est introuvable."
        fi
        install -o "$app" -g "$app" -m 600 "$fcm_service_account" "$data_dir/fcm-service-account.json"
        fcm_service_account_file="$data_dir/fcm-service-account.json"
    elif [ -f "$data_dir/fcm-service-account.json" ]; then
        fcm_service_account_file="$data_dir/fcm-service-account.json"
    fi
    ynh_app_setting_set --key=fcm_service_account_file --value="$fcm_service_account_file"
    ynh_config_add_nginx
    ynh_config_add_systemd
    chown root:root "/etc/systemd/system/$app.service"
    chmod 640 "/etc/systemd/system/$app.service"
    ynh_permission_exists --permission=admin || ynh_permission_create --permission=admin --url="$domain$path/admin.html" --additional_urls="$domain$path/admin-versions.html" "$domain$path/api/admin" --allowed=admins --show_tile=false
    ynh_permission_exists --permission=agent_calendar || ynh_permission_create --permission=agent_calendar --url="$domain$path/agent-calendar.html" --additional_urls="$domain$path/api/agents" --allowed="$agent_user" --show_tile=false
    yunohost service add "$app" --description="Catalogue de formation SDIS 53" --log="systemd"
}

refresh_package_config() {
    fcm_service_account_file="$(ynh_app_setting_get --key=fcm_service_account_file)"
    ynh_config_add_nginx
    ynh_config_add_systemd
    chown root:root "/etc/systemd/system/$app.service"
    chmod 640 "/etc/systemd/system/$app.service"
    yunohost service add "$app" --description="Catalogue de formation SDIS 53" --log="systemd"
}
