import re

file_path = "core_ui/templates/settings_access.html"

with open(file_path, "r") as f:
    content = f.read()

# Edit User
content = content.replace(
    '''<button type="button" onclick="openEditUserModal({{ item.user.id }})" class="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Редактировать">''',
    '''<button type="button" onclick="openEditUserModal({{ item.user.id }})" class="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Редактировать" aria-label="Редактировать пользователя">'''
)

# Password
content = content.replace(
    '''<button type="button" onclick="openPasswordModal({{ item.user.id }}, '{{ item.user.username|escapejs }}')" class="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-amber-400 transition-colors" title="Сменить пароль">''',
    '''<button type="button" onclick="openPasswordModal({{ item.user.id }}, '{{ item.user.username|escapejs }}')" class="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-amber-400 transition-colors" title="Сменить пароль" aria-label="Сменить пароль">'''
)

# Delete User
content = content.replace(
    '''<button type="button" onclick="deleteUser({{ item.user.id }}, '{{ item.user.username|escapejs }}')" class="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors" title="Удалить">''',
    '''<button type="button" onclick="deleteUser({{ item.user.id }}, '{{ item.user.username|escapejs }}')" class="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors" title="Удалить" aria-label="Удалить пользователя">'''
)

# Edit Group
content = content.replace(
    '''<button type="button" onclick="openEditGroupModal({{ g.id }})" class="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Редактировать">''',
    '''<button type="button" onclick="openEditGroupModal({{ g.id }})" class="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors" title="Редактировать" aria-label="Редактировать группу">'''
)

# Delete Group
content = content.replace(
    '''<button type="button" onclick="deleteGroup({{ g.id }}, '{{ g.name|escapejs }}')" class="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors" title="Удалить">''',
    '''<button type="button" onclick="deleteGroup({{ g.id }}, '{{ g.name|escapejs }}')" class="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors" title="Удалить" aria-label="Удалить группу">'''
)

# Remove from Group
content = content.replace(
    '''<button type="button" onclick="removeFromGroup({{ g.id }}, {{ u.id }}, '{{ u.username|escapejs }}')" class="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity" title="Удалить из группы">''',
    '''<button type="button" onclick="removeFromGroup({{ g.id }}, {{ u.id }}, '{{ u.username|escapejs }}')" class="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity" title="Удалить из группы" aria-label="Удалить из группы">'''
)

with open(file_path, "w") as f:
    f.write(content)

print("Done")
